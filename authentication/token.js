const express = require("express");
const users = require("../db/users");
const crypto = require("crypto");

const router = express.Router();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const activeSessions = new Map();

function randomIntToken() {
    return crypto.randomBytes(4).readUInt32BE(0);
}

function createSession(swid) {
    let token;
    do {
        token = randomIntToken();
    } while (activeSessions.has(String(token)));

    activeSessions.set(String(token), { swid, expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
}

function getSessionSwid(token) {
    const session = activeSessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        activeSessions.delete(token);
        return null;
    }
    return session.swid;
}

// Only a hash is stored
function hashRefreshToken(refreshToken) {
    return crypto.createHash("sha256").update(refreshToken).digest("hex");
}

async function createRefreshToken(swid) {
    const refreshToken = crypto.randomBytes(32).toString("hex");
    await users.addRefreshToken(hashRefreshToken(refreshToken), swid, Date.now() + REFRESH_TTL_MS);
    return refreshToken;
}

// Returns the token swid, or null if it's unknown/expired. token cannot be used again eitherway
async function useRefreshToken(refreshToken) {
    const row = await users.takeRefreshToken(hashRefreshToken(refreshToken));
    if (!row || row.expires_at <= Date.now()) return null;
    return row.swid;
}

function sendInvalidToken(res) {
    return res.status(401).json({ code: "401", name: "SECURITY.INVALID_TOKEN", message: "Invalid token" });
}

// unref() lets the process exit normally even though this timer is still scheduled
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions) {
        if (session.expiresAt <= now) activeSessions.delete(token);
    }
    users.deleteExpiredRefreshTokens(now).catch((err) => {
        console.error("Failed to delete expired refresh tokens:", err);
    });
}, SWEEP_INTERVAL_MS).unref();

// the last "AuthZ <token>" is the current one.
function getAccessToken(req) {
    const values = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i].toLowerCase() === "authorization") values.push(req.rawHeaders[i + 1]);
    }
    const matches = [...values.join(", ").matchAll(/AuthZ\s+([^\s,]+)/g)];
    return matches.length ? matches[matches.length - 1][1] : null;
}

async function authenticateToken(req, res, next) {
    const token = getAccessToken(req);
    if (token == null) { return res.sendStatus(401); }

    const swid = getSessionSwid(token);
    if (!swid) { return sendInvalidToken(res); }

    const user = await users.getUserBySwid(swid);

    if (!user) {
        activeSessions.delete(token);
        return sendInvalidToken(res);
    }

    req.user = user;
    next();
}

module.exports = {
    router,
    createSession,
    createRefreshToken,
    useRefreshToken,
    sendInvalidToken,
    authenticateToken
}