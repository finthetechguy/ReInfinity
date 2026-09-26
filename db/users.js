const path = require("path");
const { openDb, runDb, getDb } = require("./sqlite");

const USERS_DB = path.join(__dirname, "users.sqlite3");
const SCHEMA_VERSION = 1;

let db = null;

async function initUsersDb() {
    if (db) return;

    const conn = await openDb(USERS_DB);
    await runDb(conn, `
    CREATE TABLE IF NOT EXISTS users (
        swid INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT,
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
    if (user_version === 0) {
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

async function createUser(user) {
    await runDb(requireDb(), `
    INSERT INTO users (swid, username, email, password, first_name, last_name, displayName, ageBand, image, width, height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        user.swid,
        user.username,
        user.email ?? null,
        user.password,
        user.first_name,
        user.last_name ?? null,
        user.displayName ?? null,
        user.ageBand ?? null,
        user.image ?? null,
        user.width ?? null,
        user.height ?? null
    ]);
    return user;
}

module.exports = {
    initUsersDb,
    getUserByUsername,
    getUserBySwid,
    createUser
};
