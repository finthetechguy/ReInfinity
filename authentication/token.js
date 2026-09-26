const express = require("express");
const users = require("../db/users");
const crypto = require("crypto");

const router = express.Router();

// Maps access token to swid
const activeSessions = {};

function randomIntToken() {
    return crypto.randomBytes(4).readUInt32BE(0);
}

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

    const swid = activeSessions[token];

    if (!swid) {
        return res.sendStatus(403);
    }

    const user = await users.getUserBySwid(swid);

    if (!user) { return res.sendStatus(200); }

    req.user = user;
    next();
}

module.exports = {
    router,
    activeSessions,
    randomIntToken,
    authenticateToken
}