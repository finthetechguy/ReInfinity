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

module.exports = {
    initUsersDb,
    getUserByUsername,
    getUserBySwid,
    createUser,
    updatePassword
};
