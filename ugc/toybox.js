const express = require("express");
const Busboy = require("busboy");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const zlib = require("zlib");
const crypto = require("crypto");
const token = require("../authentication/token");
const { disneyError } = require("../util/disneyErrors");
const { openDb, runDb, getDb, allDb } = require("../db/sqlite");
const router = express.Router();

// Constants for public (Disney Toyboxes) toybox data
const PUBLIC_PATH = path.join(__dirname, "..", "ugc", "public_toyboxes");
const PUBLIC_DB = path.join(PUBLIC_PATH, "db.sqlite3")
const PRIVATE_PATH = path.join(__dirname, "private_toyboxes");

// Toybox IDs double as file names, so they may only contain characters that are safe in a path.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WINDOWS_RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i;
const SWID = /^\d{8}$/;

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_TOYBOX_BYTES = 32 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const SCREENSHOT_KEYS = ["width", "height", "size", "format", "platform"];

const LATER_COLUMNS = { zone: "TEXT", screenshot_info: "TEXT" };

function toSafeId(name) {
    const id = String(name).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
    if (!id || WINDOWS_RESERVED_NAME.test(id)) {
        return crypto.randomBytes(6).toString("hex");
    }
    return id;
}

function getUserPaths(user) {
    const swid = String(user.swid);
    if (!SWID.test(swid)) return null;

    const dir = path.join(PRIVATE_PATH, swid);
    return { dir, dbPath: path.join(dir, "db.sqlite3") };
}

function sendInvalidUser(res) {
    return res.status(403).json(disneyError("SECURITY.INVALID_USER"));
}

// The client only reads the status so the reason is just logged.
function sendBadUpload(res, reason) {
    console.warn(`[ugc/toybox] Rejected upload: ${reason}`);
    return res.status(400).json(disneyError("INPUT.MISSING_DATA.UNKNOWN"));
}

// Check if data has the header/magic of a gzip. Toybox level data is encoded this way.
function isGzip(buf) {
    return Buffer.isBuffer(buf) && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

// Closes the DB even if fn throws.
async function withDb(dbPath, fn) {
    const db = await openDb(dbPath);
    try {
        return await fn(db);
    } finally {
        db.close();
    }
}

// Creates a toybox database including it's folder if not already created.
async function createDb(dbPath) {
    await fsp.mkdir(path.dirname(dbPath), { recursive: true });
    const createSql = `
    CREATE TABLE IF NOT EXISTS toyboxes (
        _id TEXT PRIMARY KEY,
        name TEXT,
        desc TEXT,
        type TEXT,
        version INTEGER,
        shared INTEGER DEFAULT 0,
        user_can_like INTEGER DEFAULT 0,
        orig_size INTEGER,
        comp_size INTEGER,
        title TEXT,
        description TEXT,
        creator TEXT,
        zone TEXT,
        screenshot_info TEXT,
        creation_time INTEGER,
        last_update_time INTEGER
    );
    `;
    
    await withDb(dbPath, async (db) => {
        await runDb(db, createSql);

        const columns = await allDb(db, "PRAGMA table_info(toyboxes)");
        for (const [name, type] of Object.entries(LATER_COLUMNS)) {
            if (!columns.some(c => c.name === name)) {
                await runDb(db, `ALTER TABLE toyboxes ADD COLUMN ${name} ${type}`);
            }
        }
    });
}

const ITEM_COLUMNS = "_id, name, desc, type, version, creator, zone, orig_size, comp_size, creation_time, last_update_time";

// screenshot is a raw texture the game decodes using these values
function parseScreenshot(info, buffer) {
    if (!info || !buffer || buffer.length === 0 || buffer.length > MAX_SCREENSHOT_BYTES) return null;
    if (!SCREENSHOT_KEYS.every(k => Number.isInteger(info[k]) && info[k] > 0)) return null;
    if (info.size !== buffer.length) return null;

    const cleanInfo = Object.fromEntries(SCREENSHOT_KEYS.map(k => [k, info[k]]));
    return { info: cleanInfo, buffer };
}

function screenshotPath(dir, id) {
    return path.join(dir, `${id}.screenshot`);
}

function toItem(row) {
    return {
        _id: row._id,
        name: row.name,
        desc: row.desc,
        type: row.type,
        version: row.version,
        creator: row.creator || "",
        zone: row.zone || "",
        orig_size: row.orig_size,
        comp_size: row.comp_size,
        creation_time: row.creation_time,
        last_update_time: row.last_update_time
    };
}

// Parses the URL parameters (e.g. page size)
function parseListQuery(req) {
    const query = (req && req.query) ? req.query : {};

    let page = parseInt(query.page || "1", 10);
    let page_size = parseInt(query.page_size || "100", 10);

    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(page_size) || page_size < 1) page_size = 100;

    if (page_size > 1000) page_size = 1000;

    const offset = (page - 1) * page_size;

    const allowedSortFields = {
        _id: "_id",
        name: "name",
        creation_time: "creation_time",
        last_update_time: "last_update_time",
        orig_size: "orig_size",
        comp_size: "comp_size"
    };

    const requestedField = ((query.sort_field || "creation_time") + "").toLowerCase();
    const sortField = allowedSortFields[requestedField] || "creation_time";

    let dir = ((query.sort_direction || "desc") + "").toLowerCase();
    dir = dir === "asc" ? "ASC" : "DESC";

    const orderBy = `${sortField} ${dir}`;

    return { page, page_size, offset, orderBy };
}

async function sendJson(dbPath, req, res) {
    await createDb(dbPath);
    const { page_size, offset, orderBy } = parseListQuery(req);

    const sql = `SELECT ${ITEM_COLUMNS} FROM toyboxes
                 ORDER BY ${orderBy}
                 LIMIT ? OFFSET ?`;
    const { rows, countRow } = await withDb(dbPath, async (db) => ({
        rows: await allDb(db, sql, [page_size, offset]),
        countRow: await getDb(db, `SELECT COUNT(1) as cnt FROM toyboxes`)
    }));

    const items = rows.map(toItem);

    res.json({
        page_size,
        page_count: Math.max(1, Math.ceil((countRow ? countRow.cnt : items.length) / page_size)),
        total_items: countRow ? countRow.cnt : items.length,
        items
    });
}

(async () => {
    try {
        await createDb(PUBLIC_DB);
    } catch (err) {
        console.error("[ugc/toybox] DB init failed:", err);
    }
})();

// Creates a unique _id name to save in corresponding toybox directory
async function getUniqueId(dbPath, base) {
    await createDb(dbPath);
    return withDb(dbPath, async (db) => {
        let attempt = 0;
        let candidate = base;
        while (await getDb(db, `select _id FROM toyboxes WHERE _id = ?`, [candidate])) {
            attempt++;
            candidate = `${base}_${attempt}`;
        }
        return candidate;
    });
}

async function toyboxExists(dbPath, id) {
    await createDb(dbPath);
    const row = await withDb(dbPath, db => getDb(db, `SELECT _id FROM toyboxes WHERE _id = ?`, [id]));
    return Boolean(row);
}

/// Read endpoints

router.get(["/public/in1/toybox", "/public/toybox"], (req, res) => {
    return sendJson(PUBLIC_DB, req, res);
});

router.get("/private/in1/toybox", token.authenticateToken, (req, res) => {
    const userPaths = getUserPaths(req.user);
    if (!userPaths) return sendInvalidUser(res);

    return sendJson(userPaths.dbPath, req, res);
});

async function createToybox(dbPath, fields) {
    const id = await getUniqueId(dbPath, toSafeId(fields.name));
    const now = Math.floor(Date.now() / 1000);
    const row = {
        ...fields,
        _id: id,
        type: "game",
        version: 1,
        shared: 1,
        user_can_like: 1,
        creation_time: now,
        last_update_time: now
    };

    await withDb(dbPath, db => runDb(db, `INSERT INTO toyboxes
        (_id, name, desc, type, version, shared, user_can_like, orig_size, comp_size, title, description, creator, zone, screenshot_info, creation_time, last_update_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        row._id, row.name, row.desc, row.type, row.version, row.shared, row.user_can_like,
        row.orig_size, row.comp_size, row.title, row.description, row.creator, row.zone,
        row.screenshot_info, row.creation_time, row.last_update_time
    ]));
    return row;
}

// Overwrite keeps _id, creation_time and creator; returns null if the toybox doesn't exist.
async function updateToybox(dbPath, id, fields) {
    return withDb(dbPath, async (db) => {
        const result = await runDb(db, `UPDATE toyboxes SET
            name = ?, desc = ?, zone = ?, title = ?, description = ?, orig_size = ?, comp_size = ?,
            screenshot_info = ?, version = version + 1, last_update_time = ?
            WHERE _id = ?`, [
            fields.name, fields.desc, fields.zone, fields.title, fields.description,
            fields.orig_size, fields.comp_size, fields.screenshot_info, Math.floor(Date.now() / 1000), id
        ]);
        return result.changes > 0
            ? getDb(db, `SELECT ${ITEM_COLUMNS} FROM toyboxes WHERE _id = ?`, [id])
            : null;
    });
}

// Parses the client multipart upload, existingId means overwrite (PUT) instead of create (POST).
async function handleUpload(req, res, dbPath, dir, existingId = null) {
    let bb;
    try {
        bb = Busboy({
            headers: req.headers,
            limits: { fileSize: MAX_UPLOAD_BYTES, fieldSize: MAX_UPLOAD_BYTES, files: 2, fields: 10 }
        });
    } catch {
        return sendBadUpload(res, "expected multipart/form-data");
    }
    let meta = null;
    let contentBuffer = null;
    let tooLarge = false;
    let shotInfo = null;
    let shotBuffer = null;

    bb.on("file", (fieldname, stream) => {
        if (fieldname === "screenshot") {
            // An oversized screenshot is dropped
            const chunks = [];
            let size = 0;
            stream.on("data", (d) => {
                size += d.length;
                if (size <= MAX_SCREENSHOT_BYTES) chunks.push(d);
            });
            stream.on("end", () => { shotBuffer = size <= MAX_SCREENSHOT_BYTES ? Buffer.concat(chunks) : null; });
            return;
        }
        if (fieldname !== "content") {
            stream.resume();
            return;
        }
        const chunks = [];
        stream.on("limit", () => { tooLarge = true; });
        stream.on("data", (d) => chunks.push(d));
        stream.on("end", () => { contentBuffer = Buffer.concat(chunks); });
    });

    bb.on("field", (name, val, info) => {
        if (info.valueTruncated) {
            tooLarge = true;
        } else if (name === "contentInfo") {
            try { meta = JSON.parse(val); } catch { meta = null; }
        } else if (name === "screenshotInfo") {
            try { shotInfo = JSON.parse(val); } catch { shotInfo = null; }
        } else if (name === "content" && info && info.mimeType === "application/octet-stream") {
            const enc = (info.encoding || "binary").toLowerCase();
            contentBuffer = Buffer.from(val, enc === "binary" ? "binary" : "utf8");
        }
    });
    
    bb.on("error", (err) => {
        req.unpipe(bb);
        req.resume();
        if (!res.headersSent) sendBadUpload(res, `malformed multipart body (${err.message})`);
    });

    bb.on("finish", async () => {
        try {
            if (tooLarge) return sendBadUpload(res, "toybox too large");
            if (!meta) return sendBadUpload(res, "missing or invalid JSON (contentInfo)");
            if (!contentBuffer || !isGzip(contentBuffer)) {
                return sendBadUpload(res, "missing or invalid gzip (content)");
            }

            const compSize = contentBuffer.length;

            let origSize;
            try {
                const raw = zlib.gunzipSync(contentBuffer, { maxOutputLength: MAX_TOYBOX_BYTES });
                origSize = raw.length;
            } catch (err) {
                if (err.code === "ERR_BUFFER_TOO_LARGE") return sendBadUpload(res, "toybox too large");
                if (contentBuffer.length < 4) {
                    return sendBadUpload(res, "corrupt gzip (too small for ISIZE)");
                }
                origSize = contentBuffer.readUInt32LE(contentBuffer.length - 4);
            }

            if (!meta.name) return sendBadUpload(res, "missing 'name' key (contentInfo)");
            await createDb(dbPath);

            const screenshot = parseScreenshot(shotInfo, shotBuffer);
            const fields = {
                name: meta.name,
                desc: meta.desc || "",
                creator: meta.creator || "",
                zone: meta.zone == null ? "" : String(meta.zone),
                title: meta.title || meta.name || "",
                description: meta.description || meta.desc || "",
                orig_size: origSize,
                comp_size: compSize,
                screenshot_info: screenshot ? JSON.stringify(screenshot.info) : null
            };
            const row = existingId
                ? await updateToybox(dbPath, existingId, fields)
                : await createToybox(dbPath, fields);
            if (!row) return res.status(404).end();

            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(path.join(dir, row._id), contentBuffer);
            if (screenshot) {
                await fsp.writeFile(screenshotPath(dir, row._id), screenshot.buffer);
            } else {
                await fsp.rm(screenshotPath(dir, row._id), { force: true });
            }

            res.status(200).json(toItem(row));
        } catch (err) {
            console.error("[ugc/toybox] Upload failed:", err);
            if (!res.headersSent) res.status(503).json(disneyError("SYSTEM.UNRESPONSIVE.AUTHENTICATE"));
        }
    });

    req.pipe(bb);
}

router.post("/public/in1/toybox", (req, res) => {
    handleUpload(req, res, PUBLIC_DB, PUBLIC_PATH);
});

router.post("/private/in1/toybox", token.authenticateToken, (req, res) => {
    const userPaths = getUserPaths(req.user);
    if (!userPaths) return sendInvalidUser(res);

    handleUpload(req, res, userPaths.dbPath, userPaths.dir);
});

router.put("/private/in1/toybox/:name", token.authenticateToken, async (req, res) => {
    const userPaths = getUserPaths(req.user);
    if (!userPaths) return sendInvalidUser(res);

    const id = req.params.name;
    if (!SAFE_ID.test(id) || !(await toyboxExists(userPaths.dbPath, id))) {
        return res.status(404).end();
    }

    handleUpload(req, res, userPaths.dbPath, userPaths.dir, id);
});

// Only IDs listed in the toybox DB are served, so other files in the folder (like db.sqlite3) can't be downloaded.
async function handleDownload(res, dbPath, dir, id) {
    if (!SAFE_ID.test(id) || !(await toyboxExists(dbPath, id))) {
        return res.status(404).end();
    }

    const tb = path.join(dir, id);
    fs.access(tb, fs.constants.F_OK, (err) => {
        if (err) return res.status(404).end();

        res.set({
            "Content-Type": "application/gzip",
            "Content-Disposition": 'attachment; filename="hi.gz"'
        });

        const readStream = fs.createReadStream(tb);
        readStream.pipe(res);
    });
}

router.get("/public/in1/toybox/:name", (req, res) => {
    return handleDownload(res, PUBLIC_DB, PUBLIC_PATH, req.params.name);
});

router.get("/private/in1/toybox/:name", token.authenticateToken, (req, res) => {
    const userPaths = getUserPaths(req.user);
    if (!userPaths) return sendInvalidUser(res);

    return handleDownload(res, userPaths.dbPath, userPaths.dir, req.params.name);
});

// The client reads the screenshot's dimensions and format from the x-binary-metadata header
async function handleScreenshot(res, dbPath, dir, id) {
    if (!SAFE_ID.test(id)) return res.status(404).end();

    await createDb(dbPath);
    const row = await withDb(dbPath, db => getDb(db, `SELECT screenshot_info FROM toyboxes WHERE _id = ?`, [id]));
    if (!row || !row.screenshot_info) return res.status(404).end();

    let image;
    try {
        image = await fsp.readFile(screenshotPath(dir, id));
    } catch (err) {
        if (err.code === "ENOENT") return res.status(404).end();
        throw err;
    }
    const metadata = { ...JSON.parse(row.screenshot_info), filename: `${id}.screenshot` };
    res.set({
        "Content-Type": "application/octet-stream",
        "x-binary-metadata": JSON.stringify(metadata)
    });
    res.end(image);
}

router.get("/public/in1/toybox/:name/screenshot", (req, res) => {
    return handleScreenshot(res, PUBLIC_DB, PUBLIC_PATH, req.params.name);
});

router.get("/private/in1/toybox/:name/screenshot", token.authenticateToken, (req, res) => {
    const userPaths = getUserPaths(req.user);
    if (!userPaths) return sendInvalidUser(res);

    return handleScreenshot(res, userPaths.dbPath, userPaths.dir, req.params.name);
});

async function handleDelete(res, dbPath, dir, id) {
    if (!SAFE_ID.test(id)) return res.status(404).end();

    await createDb(dbPath);
    const result = await withDb(dbPath, db => runDb(db, `DELETE FROM toyboxes WHERE _id = ?`, [id]));

    if (result.changes > 0) {
        await fsp.rm(path.join(dir, id), { force: true });
        await fsp.rm(screenshotPath(dir, id), { force: true });
    }

    res.status(204).end();
}

router.delete("/private/in1/toybox/:name", token.authenticateToken, (req, res) => {
    const userPaths = getUserPaths(req.user);
    if (!userPaths) return sendInvalidUser(res);

    return handleDelete(res, userPaths.dbPath, userPaths.dir, req.params.name);
});

module.exports = router;