const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const USER_DB = path.join(__dirname, "..", "db", "users.json");
const activeSessions = {};

function loadUsers() {
  const raw = fs.readFileSync(USER_DB, "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data.users) ? data.users : [];
}

function authenticateToken(req, res, next) {
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

    const username = activeSessions[token];

    if (!username) {
        return res.sendStatus(403);
    }

    const user = loadUsers().find(u => u.username === username);

    if (!user) { return res.sendStatus(200); }

    req.user = user;
    next();
}

module.exports = {
    router,
    activeSessions,
    authenticateToken,
    loadUsers
}