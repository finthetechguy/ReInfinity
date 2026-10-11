const path = require("path");
const crypto = require("crypto");
const { openDb } = require("../db/sqlite");

// Toybox IDs double as file names, so they may only contain characters that are safe in a path.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WINDOWS_RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i;

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const SCREENSHOT_KEYS = ["width", "height", "size", "format", "platform"];
const MAX_OBJECT_COUNT_ENTRIES = 10000;

function toSafeId(name) {
    const id = String(name).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
    if (!id || WINDOWS_RESERVED_NAME.test(id)) {
        return crypto.randomBytes(6).toString("hex");
    }
    return id;
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

// screenshot is a raw texture the game decodes using these values
function parseScreenshot(info, buffer) {
    if (!info || !buffer || buffer.length === 0 || buffer.length > MAX_SCREENSHOT_BYTES) return null;
    if (!SCREENSHOT_KEYS.every(k => Number.isInteger(info[k]) && info[k] > 0)) return null;
    if (info.size !== buffer.length) return null;

    const cleanInfo = Object.fromEntries(SCREENSHOT_KEYS.map(k => [k, info[k]]));
    return { info: cleanInfo, buffer };
}

function parseObjectCounts(counts) {
    if (!counts || typeof counts !== "object" || Array.isArray(counts)) return "{}";

    const clean = {};
    for (const [id, count] of Object.entries(counts).slice(0, MAX_OBJECT_COUNT_ENTRIES)) {
        if (/^\d{1,10}$/.test(id) && Number.isInteger(count) && count >= 0) clean[id] = count;
    }
    return JSON.stringify(clean);
}

function screenshotPath(dir, id) {
    return path.join(dir, `${id}.screenshot`);
}

module.exports = {
    SAFE_ID,
    MAX_SCREENSHOT_BYTES,
    toSafeId,
    withDb,
    parseScreenshot,
    parseObjectCounts,
    screenshotPath
};
