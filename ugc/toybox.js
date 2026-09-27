const express = require("express");
const Busboy = require("busboy");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const zlib = require("zlib");
const crypto = require("crypto");
const token = require("../authentication/token");
const { send } = require("process");
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
    return res.status(403).json({ code: "100", name: "SECURITY.INVALID_USER" });
}

function sendTooLarge(res) {
    return res.status(413).json({ error: "Toybox too large" });
}

// Check if data has the header/magic of a gzip. Toybox level data is encoded this way.
function isGzip(buf) {
    return Buffer.isBuffer(buf) && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

// Creates a toybox database including it's folder if not already created.
async function createDb(dbPath) {
    await fsp.mkdir(path.dirname(dbPath), { recursive: true });
    const db = await openDb(dbPath);
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
        creation_time INTEGER,
        last_update_time INTEGER
    );
    `;
    
    await runDb(db, createSql);

    const columns = await allDb(db, "PRAGMA table_info(toyboxes)");
    if (!columns.some(c => c.name === "zone")) {
        await runDb(db, "ALTER TABLE toyboxes ADD COLUMN zone TEXT");
    }
    db.close();
}

const ITEM_COLUMNS = "_id, name, desc, type, version, creator, zone, orig_size, comp_size, creation_time, last_update_time";

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
    try {
        await createDb(dbPath);
        const db = await openDb(dbPath);

        const { page_size, offset, orderBy, page } = parseListQuery(req);

    const sql = `SELECT ${ITEM_COLUMNS} FROM toyboxes
                 ORDER BY ${orderBy}
                 LIMIT ? OFFSET ?`;
    const rows = await allDb(db, sql, [page_size, offset]);
    const countRow = await getDb(db, `SELECT COUNT(1) as cnt FROM toyboxes`);

    db.close();

    const items = rows.map(toItem);

    res.json({
        page_size,
        page_count: Math.max(1, Math.ceil((countRow ? countRow.cnt : items.length) / page_size)),
        total_items: countRow ? countRow.cnt : items.length,
        items
    });

    } catch (err) {
        console.error("[ugc/toybox] sendSqliteJson error:", err);
        res.status(500);
    }
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
    const db = await openDb(dbPath);
    let attempt = 0;
    let candidate = base;
    while (true) {
        const row = await getDb(db, `select _id FROM toyboxes WHERE _id = ?`, [candidate]);
        if (!row) {
            db.close();
            return candidate;
        }
        attempt++;
        candidate = `${base}_${attempt}`;
    }
}

async function toyboxExists(dbPath, id) {
    await createDb(dbPath);
    const db = await openDb(dbPath);
    const row = await getDb(db, `SELECT _id FROM toyboxes WHERE _id = ?`, [id]);
    db.close();
    return Boolean(row);
}

/// Read endpoints

router.get(["/public/in1/toybox", "/public/toybox"], async (req, res) => {
    await sendJson(PUBLIC_DB, req, res);
});

router.get("/private/in1/toybox", token.authenticateToken, async (req, res) => {
    try {
        const userPaths = getUserPaths(req.user);
        if (!userPaths) return sendInvalidUser(res);

        await createDb(userPaths.dbPath);
        await sendJson(userPaths.dbPath, req, res);
    } catch (err) {
        console.error(err);
        res.status(500);
    }
});

async function handleUpload(req, res, dbPath, dir) {
    let bb;
    try {
        bb = Busboy({
            headers: req.headers,
            limits: { fileSize: MAX_UPLOAD_BYTES, fieldSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 }
        });
    } catch {
        return res.status(400).json({ error: "Expected multipart/form-data" });
    }
    let meta = null;
    let contentBuffer = null;
    let tooLarge = false;

    bb.on("file", (fieldname, stream, info) => {
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
        } else if (name === "content" && info && info.mimeType === "application/octet-stream") {
            const enc = (info.encoding || "binary").toLowerCase();
            contentBuffer = Buffer.from(val, enc === "binary" ? "binary" : "utf8");
        }
    });
    
    bb.on("error", (err) => {
        console.error("[ugc/toybox] Malformed upload:", err.message);
        req.unpipe(bb);
        req.resume();
        if (!res.headersSent) res.status(400).json({ error: "Malformed multipart body" });
    });

    bb.on("finish", async () => {
        try {
            if (tooLarge) return sendTooLarge(res);
            if (!meta) return res.status(400).json({ error: "Missing or invalid JSON (contentInfo)" });
            if (!contentBuffer || !isGzip(contentBuffer)) {
                return res.status(415).json({ error: "Missing or invalid gzip (content)" });
            }

            const compSize = contentBuffer.length;

            let origSize;
            try {
                const raw = zlib.gunzipSync(contentBuffer, { maxOutputLength: MAX_TOYBOX_BYTES });
                origSize = raw.length;
            } catch (err) {
                if (err.code === "ERR_BUFFER_TOO_LARGE") return sendTooLarge(res);
                if (contentBuffer.length < 4) {
                    return res.status(415).json({ error: "Corrupt gzip (too small for ISIZE)" });
                }
                origSize = contentBuffer.readUInt32LE(contentBuffer.length - 4);
            }

            if (!meta.name) return res.status(400).json({ error: "Missing 'name' key (contentInfo)" });
            await createDb(dbPath);
            const cleanName = await getUniqueId(dbPath, toSafeId(meta.name));

            const toyboxInfo = {
                _id: cleanName,
                name: meta.name,
                desc: meta.desc || "",
                type: "game",
                version: 1,
                shared: 1,
                user_can_like: 1,
                creator: meta.creator || "",
                zone: meta.zone == null ? "" : String(meta.zone)
            };

            const db = await openDb(dbPath);
            const insertSql = `INSERT INTO toyboxes
                (_id, name, desc, type, version, shared, user_can_like, orig_size, comp_size, title, description, creator, zone, creation_time, last_update_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const creationTime = Math.floor(Date.now() / 1000);
            await runDb(db, insertSql, [
                toyboxInfo._id,
                toyboxInfo.name,
                toyboxInfo.desc,
                toyboxInfo.type,
                toyboxInfo.version,
                toyboxInfo.shared,
                toyboxInfo.user_can_like,
                origSize,
                compSize,
                meta.title || meta.name || "",
                meta.description || meta.desc || "",
                toyboxInfo.creator,
                toyboxInfo.zone,
                creationTime,
                creationTime
            ]);
            db.close();

            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(path.join(dir, cleanName), contentBuffer);

            res.status(200).json(toItem({
                ...toyboxInfo,
                orig_size: origSize,
                comp_size: compSize,
                creation_time: creationTime,
                last_update_time: creationTime
            }));
        } catch (err) {
            console.error(err);
            res.status(503).end();
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

// Only IDs listed in the toybox DB are served, so other files in the folder (like db.sqlite3) can't be downloaded.
async function handleDownload(res, dbPath, dir, id) {
    try {
        if (!SAFE_ID.test(id) || !(await toyboxExists(dbPath, id))) {
            return res.status(404).end();
        }
    } catch (err) {
        console.error(err);
        return res.status(500).end();
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
    handleDownload(res, PUBLIC_DB, PUBLIC_PATH, req.params.name);
});

router.get("/private/in1/toybox/:name", token.authenticateToken, (req, res) => {
    const userPaths = getUserPaths(req.user);
    if (!userPaths) return sendInvalidUser(res);

    handleDownload(res, userPaths.dbPath, userPaths.dir, req.params.name);
});

async function handleDelete(res, dbPath, dir, id) {
    if (!SAFE_ID.test(id)) return res.status(404).end();

    try {
        await createDb(dbPath);
        const db = await openDb(dbPath);
        const result = await runDb(db, `DELETE FROM toyboxes WHERE _id = ?`, [id]);
        db.close();

        if (result.changes > 0) {
            await fsp.rm(path.join(dir, id), { force: true });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).end();
    }

    res.status(204).end();
}

router.delete("/private/in1/toybox/:name", token.authenticateToken, (req, res) => {
    const userPaths = getUserPaths(req.user);
    if (!userPaths) return sendInvalidUser(res);

    handleDelete(res, userPaths.dbPath, userPaths.dir, req.params.name);
});

module.exports = router;