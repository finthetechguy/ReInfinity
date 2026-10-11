const express = require("express");
const Busboy = require("busboy");
const path = require("path");
const fsp = require("fs/promises");
const zlib = require("zlib");
const { Transform } = require("stream");
const token = require("../authentication/token");
const { disneyError } = require("../util/disneyErrors");
const { runDb, getDb, allDb } = require("../db/sqlite");
const { SAFE_ID, MAX_SCREENSHOT_BYTES, toSafeId, withDb, parseScreenshot, parseObjectCounts, screenshotPath } = require("./common");
const router = express.Router();

// Disney Infinity 2.0 toyboxes
const PUBLIC_PATH = path.join(__dirname, "public_toyboxes_in2");
const PRIVATE_PATH = path.join(__dirname, "private_toyboxes_in2");
const PUBLIC_STORE = { dir: PUBLIC_PATH, dbPath: path.join(PUBLIC_PATH, "db.sqlite3") };
const SWID = /^\d{8}$/;

const TYPES = ["toybox", "game"];
const MAX_TOYBOX_BYTES = 32 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_TOYBOX_BYTES + MAX_SCREENSHOT_BYTES + 64 * 1024;
const LOG_PREVIEW_BYTES = 160;

const SORT_FIELDS = ["name", "creation_time", "last_update_time", "downloads", "likes"];

const LATER_COLUMNS = { shared: "INTEGER DEFAULT 1" };

async function createDb(store) {
    await fsp.mkdir(store.dir, { recursive: true });
    await withDb(store.dbPath, async (db) => {
        await runDb(db, `
        CREATE TABLE IF NOT EXISTS toyboxes (
            _id TEXT PRIMARY KEY,
            type TEXT,
            name TEXT,
            desc TEXT,
            creator_id TEXT,
            creator_display_name TEXT,
            has_text_toy INTEGER DEFAULT 0,
            toybox_size INTEGER,
            screenshot_info TEXT,
            object_counts TEXT,
            downloads INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0,
            creation_time INTEGER,
            last_update_time INTEGER
        )`);
        await runDb(db, `
        CREATE TABLE IF NOT EXISTS likes (
            toybox_id TEXT,
            swid TEXT,
            PRIMARY KEY (toybox_id, swid)
        )`);

        const columns = await allDb(db, "PRAGMA table_info(toyboxes)");
        for (const [name, type] of Object.entries(LATER_COLUMNS)) {
            if (!columns.some(c => c.name === name)) await runDb(db, `ALTER TABLE toyboxes ADD COLUMN ${name} ${type}`);
        }
    });
}

const dbReady = new Map();
function ensureDb(store) {
    if (!dbReady.has(store.dbPath)) {
        dbReady.set(store.dbPath, createDb(store).catch((err) => {
            dbReady.delete(store.dbPath);
            throw err;
        }));
    }
    return dbReady.get(store.dbPath);
}

ensureDb(PUBLIC_STORE).catch((err) => {
    console.error("[ugc/toyboxIn2] DB init failed:", err);
});

function getPrivateStore(user) {
    const swid = String(user.swid);
    if (!SWID.test(swid)) return null;
    const dir = path.join(PRIVATE_PATH, swid);
    return { dir, dbPath: path.join(dir, "db.sqlite3") };
}

// The client only reads the status so the reason is just logged
function sendBadUpload(res, reason) {
    console.warn(`[ugc/toyboxIn2] Rejected upload: ${reason}`);
    return res.status(400).json(disneyError("INPUT.MISSING_DATA.UNKNOWN"));
}

function toItem(row, likedIds = new Set()) {
    return {
        _id: row._id,
        _creatorId: row.creator_id || "",
        _status: 3,
        name: row.name,
        desc: row.desc,
        type: row.type,
        version: 2,
        creator_display_name: row.creator_display_name || "",
        creator_platform_name: "ios",
        creation_time: row.creation_time,
        last_update_time: row.last_update_time,
        downloads: { count: row.downloads },
        likes: { count: row.likes },
        user_can_like: !likedIds.has(row._id),
        shared: row.shared !== 0,
        hasTextToy: Boolean(row.has_text_toy),
        genres: [],
        object_counts: row.object_counts || "{}"
    };
}

function parseListQuery(query) {
    let page = parseInt(query.page || "1", 10);
    let pageSize = parseInt(query.page_size || "50", 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 50;
    if (pageSize > 200) pageSize = 200;

    const sortField = SORT_FIELDS.includes(query.sort_field) ? query.sort_field : "last_update_time";
    const sortDir = String(query.sort_direction).toLowerCase() === "asc" ? "ASC" : "DESC";

    const types = String(query.types || "toybox,game").split(",").filter(t => TYPES.includes(t));
    const wantsV2 = query.versions == null || String(query.versions).split(",").includes("2");

    return { page, pageSize, orderBy: `${sortField} ${sortDir}`, types: wantsV2 ? types : [] };
}

async function getLikedIds(db, user) {
    if (!user) return new Set();
    const rows = await allDb(db, "SELECT toybox_id FROM likes WHERE swid = ?", [String(user.swid)]);
    return new Set(rows.map(r => r.toybox_id));
}

async function sendList(req, res, orderBy) {
    await ensureDb(PUBLIC_STORE);
    const query = parseListQuery(req.query);
    const placeholders = query.types.map(() => "?").join(", ") || "NULL";

    const { rows, total, likedIds } = await withDb(PUBLIC_STORE.dbPath, async (db) => ({
        rows: await allDb(db, `SELECT * FROM toyboxes WHERE type IN (${placeholders})
            ORDER BY ${orderBy || query.orderBy} LIMIT ? OFFSET ?`,
        [...query.types, query.pageSize, (query.page - 1) * query.pageSize]),
        total: (await getDb(db, `SELECT COUNT(1) AS cnt FROM toyboxes WHERE type IN (${placeholders})`, query.types)).cnt,
        likedIds: await getLikedIds(db, req.user)
    }));

    res.json({
        page_size: query.pageSize,
        page_count: Math.max(1, Math.ceil(total / query.pageSize)),
        total_items: total,
        items: rows.map(row => toItem(row, likedIds))
    });
}

async function getRow(store, id) {
    if (!SAFE_ID.test(id)) return null;
    await ensureDb(store);
    return withDb(store.dbPath, db => getDb(db, "SELECT * FROM toyboxes WHERE _id = ?", [id]));
}

async function getUniqueId(store, base) {
    return withDb(store.dbPath, async (db) => {
        let candidate = base === "trending" ? `${base}_1` : base;
        for (let attempt = 1; await getDb(db, "SELECT _id FROM toyboxes WHERE _id = ?", [candidate]); attempt++) {
            candidate = `${base}_${attempt}`;
        }
        return candidate;
    });
}

function readToyboxMeta(toybox) {
    try {
        const meta = JSON.parse(toybox.toString("utf8"));
        if (meta && typeof meta === "object" && !Array.isArray(meta)) return meta;
    } catch {
        // Not JSON: stored with a default name.
    }
    const preview = toybox.subarray(0, LOG_PREVIEW_BYTES).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
    console.warn(`[ugc/toyboxIn2] Toybox part isn't JSON: ${toybox.length} bytes, starts "${preview}"`);
    return {};
}

// Stops a decompressed upload that grows past the limit.
function sizeLimit(maxBytes) {
    let total = 0;
    return new Transform({
        transform(chunk, _enc, callback) {
            total += chunk.length;
            if (total > maxBytes) return callback(new Error("upload too large"));
            callback(null, chunk);
        }
    });
}

// 2.0 sends multipart/vnd.disney.infinity.toybox+form-data with whole body gzipped, and parts without filenames.
// existingId means overwrite (PUT) instead of create (POST).
function handleUpload(req, res, store, type, existingId = null) {
    const contentType = String(req.headers["content-type"] || "");
    let bb;
    try {
        bb = Busboy({
            headers: { ...req.headers, "content-type": contentType.replace(/^multipart\/[^;]+/i, "multipart/form-data") },
            // latin1 keeps binary part bodies byte-for-byte.
            defCharset: "latin1",
            limits: { fieldSize: MAX_TOYBOX_BYTES, fileSize: MAX_TOYBOX_BYTES, fields: 5, files: 3 }
        });
    } catch {
        return sendBadUpload(res, `expected multipart, got "${contentType}"`);
    }

    const parts = {};
    let tooLarge = false;

    bb.on("field", (name, val, info) => {
        if (info.valueTruncated) tooLarge = true;
        else parts[name] = Buffer.from(val, "latin1");
    });
    bb.on("file", (name, stream) => {
        const chunks = [];
        stream.on("limit", () => { tooLarge = true; });
        stream.on("data", d => chunks.push(d));
        stream.on("end", () => { parts[name] = Buffer.concat(chunks); });
    });

    let failed = false;
    const fail = (reason) => {
        if (failed) return;
        failed = true;
        req.unpipe();
        req.resume();
        if (!res.headersSent) sendBadUpload(res, reason);
    };
    bb.on("error", err => fail(`malformed multipart body (${err.message})`));

    bb.on("finish", async () => {
        if (failed) return;
        try {
            if (tooLarge) return sendBadUpload(res, "toybox too large");
            const toybox = parts.toybox;
            if (!toybox || toybox.length === 0) return sendBadUpload(res, "missing toybox part");

            const meta = readToyboxMeta(toybox);
            let shotInfo = null;
            try { shotInfo = parts.screenshotInfo ? JSON.parse(parts.screenshotInfo.toString("utf8")) : null; } catch { shotInfo = null; }
            const screenshot = parseScreenshot(shotInfo, parts.screenshot);

            const fields = {
                name: String(meta.name || meta.title || "Toy Box").slice(0, 200),
                desc: String(meta.desc || meta.description || "").slice(0, 2000),
                has_text_toy: meta.hasTextToy ? 1 : 0,
                toybox_size: toybox.length,
                screenshot_info: screenshot ? JSON.stringify(screenshot.info) : null,
                object_counts: parseObjectCounts(meta.object_counts),
                shared: store === PUBLIC_STORE || meta.shared === true ? 1 : 0
            };
            await ensureDb(store);
            const row = existingId
                ? await updateToybox(store, existingId, fields)
                : await insertToybox(store, req.user, type, fields);
            if (!row) return res.status(404).end();

            await fsp.writeFile(path.join(store.dir, row._id), toybox);
            if (screenshot) {
                await fsp.writeFile(screenshotPath(store.dir, row._id), screenshot.buffer);
            } else {
                await fsp.rm(screenshotPath(store.dir, row._id), { force: true });
            }

            const scope = store === PUBLIC_STORE ? "public" : `private (${req.user.swid})`;
            console.log(`[ugc/toyboxIn2] ${existingId ? "Overwrote" : "Stored"} ${scope} ${type} "${row._id}" (${toybox.length} bytes, screenshot: ${Boolean(screenshot)})`);
            res.status(200).json(toItem(row));
        } catch (err) {
            console.error("[ugc/toyboxIn2] Upload failed:", err);
            if (!res.headersSent) res.status(503).json(disneyError("SYSTEM.UNRESPONSIVE.AUTHENTICATE"));
        }
    });

    let body = req.pipe(sizeLimit(MAX_BODY_BYTES)).on("error", err => fail(err.message));
    if (/gzip/i.test(String(req.headers["content-encoding"] || ""))) {
        body = body.pipe(zlib.createGunzip()).on("error", err => fail(`bad gzip body (${err.message})`))
            .pipe(sizeLimit(MAX_BODY_BYTES)).on("error", err => fail(err.message));
    }
    body.pipe(bb);
}

async function insertToybox(store, user, type, fields) {
    const now = Math.floor(Date.now() / 1000);
    const row = {
        ...fields,
        _id: await getUniqueId(store, toSafeId(fields.name)),
        type,
        creator_id: user ? String(user.swid) : "",
        creator_display_name: user ? (user.displayName || user.username) : "",
        downloads: 0,
        likes: 0,
        creation_time: now,
        last_update_time: now
    };
    await withDb(store.dbPath, db => runDb(db, `INSERT INTO toyboxes
        (_id, type, name, desc, creator_id, creator_display_name, has_text_toy, toybox_size, screenshot_info, object_counts, shared, creation_time, last_update_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        row._id, row.type, row.name, row.desc, row.creator_id, row.creator_display_name, row.has_text_toy,
        row.toybox_size, row.screenshot_info, row.object_counts, row.shared, row.creation_time, row.last_update_time
    ]));
    return row;
}

// returns null if the toybox doesn't exist.
async function updateToybox(store, id, fields) {
    return withDb(store.dbPath, async (db) => {
        const result = await runDb(db, `UPDATE toyboxes SET
            name = ?, desc = ?, has_text_toy = ?, toybox_size = ?, screenshot_info = ?, object_counts = ?, shared = ?, last_update_time = ?
            WHERE _id = ?`, [
            fields.name, fields.desc, fields.has_text_toy, fields.toybox_size, fields.screenshot_info,
            fields.object_counts, fields.shared, Math.floor(Date.now() / 1000), id
        ]);
        return result.changes > 0 ? getDb(db, "SELECT * FROM toyboxes WHERE _id = ?", [id]) : null;
    });
}

function checkType(req, res, next) {
    if (!TYPES.includes(req.params.type)) return res.status(404).end();
    next();
}

router.get("/public/:type", checkType, token.optionalToken, (req, res) => sendList(req, res));

router.get("/public/:type/trending", checkType, token.optionalToken, (req, res) => sendList(req, res, "downloads DESC, likes DESC"));

router.post("/public/:type", checkType, token.optionalToken, (req, res) => handleUpload(req, res, PUBLIC_STORE, req.params.type));

router.post("/private/:type", checkType, token.authenticateToken, (req, res) => {
    const store = getPrivateStore(req.user);
    if (!store) return res.status(403).json(disneyError("SECURITY.INVALID_USER"));
    handleUpload(req, res, store, req.params.type);
});

router.put("/private/:type/:id", checkType, token.authenticateToken, async (req, res) => {
    const store = getPrivateStore(req.user);
    if (!store) return res.status(403).json(disneyError("SECURITY.INVALID_USER"));
    if (!(await getRow(store, req.params.id))) return res.status(404).end();
    handleUpload(req, res, store, req.params.type, req.params.id);
});

router.get("/public/:type/:id", checkType, async (req, res) => {
    const row = await getRow(PUBLIC_STORE, req.params.id);
    if (!row) return res.status(404).end();

    let toybox;
    try {
        toybox = await fsp.readFile(path.join(PUBLIC_STORE.dir, row._id));
    } catch (err) {
        if (err.code === "ENOENT") return res.status(404).end();
        throw err;
    }
    await withDb(PUBLIC_STORE.dbPath, db => runDb(db, "UPDATE toyboxes SET downloads = downloads + 1 WHERE _id = ?", [row._id]));
    res.type("application/octet-stream").end(toybox);
});

// Same screenshot format as 1.0
router.get("/public/:type/:id/screenshot", checkType, async (req, res) => {
    const row = await getRow(PUBLIC_STORE, req.params.id);
    if (!row || !row.screenshot_info) return res.status(404).end();

    let image;
    try {
        image = await fsp.readFile(screenshotPath(PUBLIC_STORE.dir, row._id));
    } catch (err) {
        if (err.code === "ENOENT") return res.status(404).end();
        throw err;
    }
    res.set({
        "Content-Type": "application/octet-stream",
        "x-binary-metadata": JSON.stringify({ ...JSON.parse(row.screenshot_info), filename: `${row._id}.screenshot` })
    });
    res.end(image);
});

router.get("/public/:type/:id/object_counts", checkType, async (req, res) => {
    const row = await getRow(PUBLIC_STORE, req.params.id);
    if (!row) return res.status(404).end();
    res.type("application/json").send(row.object_counts || "{}");
});

// One like per player
router.post("/public/:type/:id/like", checkType, token.authenticateToken, async (req, res) => {
    const row = await getRow(PUBLIC_STORE, req.params.id);
    if (!row) return res.status(404).end();

    const likes = await withDb(PUBLIC_STORE.dbPath, async (db) => {
        const result = await runDb(db, "INSERT OR IGNORE INTO likes (toybox_id, swid) VALUES (?, ?)", [row._id, String(req.user.swid)]);
        if (result.changes > 0) await runDb(db, "UPDATE toyboxes SET likes = likes + 1 WHERE _id = ?", [row._id]);
        return (await getDb(db, "SELECT likes FROM toyboxes WHERE _id = ?", [row._id])).likes;
    });
    res.json({ likes: { count: likes } });
});

module.exports = router;
