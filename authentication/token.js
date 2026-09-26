const express = require("express");
const users = require("../db/users");
const crypto = require("crypto");

const router = express.Router();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
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

// unref() lets the process exit normally even though this timer is still scheduled
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions) {
        if (session.expiresAt <= now) activeSessions.delete(token);
    }
}, SWEEP_INTERVAL_MS).unref();

async function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (authHeader == null) { return res.sendStatus(401); }

    let token = null;

    try {
        const parts = authHeader.split(', ');
        const authZPart = parts[1];

        token = authZPart.split(' ')[1];
    } catch (err) {
        console.error("[token.js] Error parsing Auth header:", err.message);
        return res.sendStatus(401);
    }

    if (token == null) { return res.sendStatus(401); }

    const swid = getSessionSwid(token);

    if (!swid) {
        return res.sendStatus(403);
    }

    const user = await users.getUserBySwid(swid);

    if (!user) {
        activeSessions.delete(token);
        return res.sendStatus(401);
    }

    req.user = user;
    next();
}

module.exports = {
    router,
    randomIntToken,
    createSession,
    authenticateToken
}