const express = require("express");
const Busboy = require("busboy");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const zlib = require("zlib");
const token = require("../authentication/token");
const { send } = require("process");
const sqlite3 = require("sqlite3").verbose();
const router = express.Router();

// Constants for public (Disney Toyboxes) toybox data
const PUBLIC_PATH = path.join(__dirname, "..", "ugc", "public_toyboxes");
const PUBLIC_DB = path.join(PUBLIC_PATH, "db.sqlite3")

// Check if data has the header/magic of a gzip. Toybox level data is encoded this way.
function isGzip(buf) {
    return Buffer.isBuffer(buf) && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

/// SQLite helpers

function openDb(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) return reject(err);
            resolve(db);
        });
    });
}

function runDb(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function getDb(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function allDb(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

///

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
        creation_time INTEGER,
        last_update_time INTEGER
    );
    `;
    
    await runDb(db, createSql);
    db.close();
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

    const sql = `SELECT _id, name, desc, type, version FROM toyboxes
                 ORDER BY ${orderBy}
                 LIMIT ? OFFSET ?`;
    const rows = await allDb(db, sql, [page_size, offset]);
    const countRow = await getDb(db, `SELECT COUNT(1) as cnt FROM toyboxes`);

    db.close();

    const items = rows.map(r => ({
        _id: r._id,
        name: r.name,
        desc: r.desc,
        type: r.type,
        version: r.version
    }));

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

/// Read endpoints

router.get(["/public/in1/toybox", "/public/toybox"], async (req, res) => {
    await sendJson(PUBLIC_DB, req, res);
});

router.get("/private/in1/toybox", token.authenticateToken, async (req, res) => {
    try {
        const userTbPath = path.join(__dirname, "private_toyboxes", req.user.swid.toString());
        const userDbPath = path.join(userTbPath, "db.sqlite3");

        await createDb(userDbPath);
        await sendJson(userDbPath, req, res);
    } catch (err) {
        console.error(err);
        res.status(500);
    }
});

async function handleUpload(req, res, dbPath, dir) {
    const bb = Busboy({ headers: req.headers });
    let meta = null;
    let contentBuffer = null;

    bb.on("file", (fieldname, stream, info) => {
        if (fieldname !== "content") {
            stream.resume();
            return;
        }
        const chunks = [];
        stream.on("data", (d) => chunks.push(d));
        stream.on("end", () => { contentBuffer = Buffer.concat(chunks); });
    });

    bb.on("field", (name, val, info) => {
        if (name === "contentInfo") {
            try { meta = JSON.parse(val); } catch { meta = null; }
        } else if (name === "content" && info && info.mimeType === "application/octet-stream") {
            const enc = (info.encoding || "binary").toLowerCase();
            contentBuffer = Buffer.from(val, enc === "binary" ? "binary" : "utf8");
        }
    });
    
    bb.on("finish", async () => {
        try {
            if (!meta) return res.status(400).json({ error: "Missing or invalid JSON (contentInfo)" });
            if (!contentBuffer || !isGzip(contentBuffer)) {
                return res.status(415).json({ error: "Missing or invalid gzip (content)" });
            }

            const compSize = contentBuffer.length;

            let origSize;
            try {
                const raw = zlib.gunzipSync(contentBuffer);
                origSize = raw.length;
            } catch {
                if (contentBuffer.length < 4) {
                    return res.status(415).json({ error: "Corrupt gzip (too small for ISIZE)" });
                }
                origSize = contentBuffer.readUInt32LE(contentBuffer.length - 4);
            }

            if (!meta.name) return res.status(400).json({ error: "Missing 'name' key (contentInfo)" });
            let cleanName = meta.name.replace(/\s+/g, '');
            const base = cleanName;

            await createDb(dbPath);
            cleanName = await getUniqueId(dbPath, base);

            const toyboxInfo = {
                _id: cleanName,
                name: meta.name,
                desc: meta.desc || "",
                type: "game",
                version: 1,
                shared: 1,
                user_can_like: 1
            };

            const db = await openDb(dbPath);
            const insertSql = `INSERT INTO toyboxes
                (_id, name, desc, type, version, shared, user_can_like, orig_size, comp_size, title, description, creator, creation_time, last_update_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
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
                meta.creator || "",
                creationTime,
                creationTime
            ]);
            db.close();

            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(path.join(dir, cleanName), contentBuffer);

            res.status(200).json({
                creation_time: creationTime
            });
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
    const userTbPath = path.join(__dirname, "private_toyboxes", req.user.swid.toString());
    const userDbPath = path.join(userTbPath, "db.sqlite3");

    handleUpload(req, res, userDbPath, userTbPath);
});

function handleDownload(res, tb) {
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
    const fileName = req.params.name;
    const filePath = path.join(PUBLIC_PATH, fileName);

    handleDownload(res, filePath);
});

router.get("/private/in1/toybox/:name", token.authenticateToken, (req, res) => {
    const userTbPath = path.join(__dirname, "private_toyboxes", req.user.swid.toString());
    const userTb = path.join(userTbPath, req.params.name);

    handleDownload(res, userTb);
});

async function handleDelete(res, dbPath, _id) {
    try {
        const db = await openDb(dbPath);
        const insertSql = `DELETE FROM toyboxes WHERE _id = '${_id}';`;
        await runDb(db, insertSql, []);
    } catch (err) {
        console.error(err);
        res.status(500).end();
    }

    res.status(204).end();
}

router.delete("/private/in1/toybox/:name", token.authenticateToken, (req, res) => {
    const userTbPath = path.join(__dirname, "private_toyboxes", req.user.swid.toString());
    const userDbPath = path.join(userTbPath, "db.sqlite3");

    handleDelete(res, userDbPath, req.params.name);
});

module.exports = router;