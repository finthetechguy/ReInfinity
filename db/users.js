const path = require("path");
const crypto = require("crypto");
const { openDb, runDb, getDb } = require("./sqlite");

const USERS_DB = path.join(__dirname, "users.sqlite3");
const SCHEMA_VERSION = 2;
const SWID_ATTEMPTS = 5;

let db = null;

async function initUsersDb() {
    if (db) return;

    const conn = await openDb(USERS_DB);
    await runDb(conn, `
    CREATE TABLE IF NOT EXISTS users (
        swid INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT,
        parents_email TEXT,
        password TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT,
        displayName TEXT,
        ageBand TEXT,
        image TEXT,
        width INTEGER,
        height INTEGER
    );
    `);

    // user_version is a number SQLite stores in the file, used to tell which schema an existing DB has.
    const { user_version } = await getDb(conn, "PRAGMA user_version");
    if (user_version === 1) {
        await runDb(conn, "ALTER TABLE users ADD COLUMN parents_email TEXT");
        await runDb(conn, "UPDATE users SET email = NULL WHERE email = 'null'");
    }
    await runDb(conn, `
    CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email COLLATE NOCASE)
    WHERE email IS NOT NULL
    `);
    await runDb(conn, `
    CREATE TABLE IF NOT EXISTS console_links (
        platform TEXT NOT NULL,
        platform_id TEXT NOT NULL,
        swid INTEGER NOT NULL REFERENCES users (swid),
        linked_at TEXT NOT NULL,
        PRIMARY KEY (platform, platform_id)
    )
    `);
    await runDb(conn, `
    CREATE TABLE IF NOT EXISTS refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        swid INTEGER NOT NULL REFERENCES users (swid),
        expires_at INTEGER NOT NULL
    )
    `);
    if (user_version < SCHEMA_VERSION) {
        await runDb(conn, `PRAGMA user_version = ${SCHEMA_VERSION}`);
    }

    db = conn;
}

function requireDb() {
    if (!db) throw new Error("Users DB not initialised, call initUsersDb() first");
    return db;
}

function getUserByUsername(username) {
    return getDb(requireDb(), "SELECT * FROM users WHERE username = ?", [String(username)]);
}

function getUserBySwid(swid) {
    return getDb(requireDb(), "SELECT * FROM users WHERE swid = ?", [swid]);
}

function generateSwid() {
    return crypto.randomInt(10000000, 100000000);
}

function isSwidClash(err) {
    return err.code === "SQLITE_CONSTRAINT" && err.message.includes("users.swid");
}

// swid generated here instead of client
async function createUser(user) {
    for (let attempt = 1; ; attempt++) {
        const swid = generateSwid();
        try {
            await runDb(requireDb(), `
            INSERT INTO users (swid, username, email, parents_email, password, first_name, last_name, displayName, ageBand, image, width, height)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                swid,
                user.username,
                user.email ?? null,
                user.parents_email ?? null,
                user.password,
                user.first_name,
                user.last_name ?? null,
                user.displayName ?? null,
                user.ageBand ?? null,
                user.image ?? null,
                user.width ?? null,
                user.height ?? null
            ]);
            return { ...user, swid };
        } catch (err) {
            if (!isSwidClash(err) || attempt >= SWID_ATTEMPTS) throw err;
        }
    }
}

function updatePassword(swid, password) {
    return runDb(requireDb(), "UPDATE users SET password = ? WHERE swid = ?", [password, swid]);
}

function getUserByConsoleAccount(platform, platformId) {
    return getDb(requireDb(), `
    SELECT users.* FROM console_links JOIN users ON users.swid = console_links.swid
    WHERE console_links.platform = ? AND console_links.platform_id = ?
    `, [platform, platformId]);
}

// console account links to one user, linking again moves the link
function linkConsoleAccount(platform, platformId, swid) {
    return runDb(requireDb(), `
    INSERT INTO console_links (platform, platform_id, swid, linked_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (platform, platform_id) DO UPDATE SET swid = excluded.swid, linked_at = excluded.linked_at
    `, [platform, platformId, swid, new Date().toISOString()]);
}

function unlinkConsoleAccount(platform, platformId) {
    return runDb(requireDb(), "DELETE FROM console_links WHERE platform = ? AND platform_id = ?", [platform, platformId]);
}

function addRefreshToken(tokenHash, swid, expiresAt) {
    return runDb(requireDb(), "INSERT INTO refresh_tokens (token_hash, swid, expires_at) VALUES (?, ?, ?)", [tokenHash, swid, expiresAt]);
}

// Deletes refresh token after so it cannot be reused
function takeRefreshToken(tokenHash) {
    return getDb(requireDb(), "DELETE FROM refresh_tokens WHERE token_hash = ? RETURNING swid, expires_at", [tokenHash]);
}

function deleteExpiredRefreshTokens(now) {
    return runDb(requireDb(), "DELETE FROM refresh_tokens WHERE expires_at <= ?", [now]);
}

module.exports = {
    initUsersDb,
    getUserByUsername,
    getUserBySwid,
    createUser,
    updatePassword,
    getUserByConsoleAccount,
    linkConsoleAccount,
    unlinkConsoleAccount,
    addRefreshToken,
    takeRefreshToken,
    deleteExpiredRefreshTokens
};
