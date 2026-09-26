const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const token = require("./token");
const users = require("../db/users");
const { hashPassword, isHashed, verifyPassword } = require("./password");
const limiter = require("./loginLimiter");

router.use(express.json());
router.use(express.urlencoded({ extended: true }));
router.use(express.text({ type: "*/*", limit: "100kb" }));

router.use((req, _res, next) => {
  if (typeof req.body === "string" && req.body.trim().length) {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      // leave as text as POST handler will handle
    }
  }
  next();
});

// Sometimes a GET request is made, send 200 to tell client it's online
router.get("/", (_req, res) => res.sendStatus(200));

router.post("/", async (req, res) => {

  if (limiter.isLocked(req.ip)) {
    return res
      .status(429)
      .json({ code: "100", name: "SYSTEM.UNRESPONSIVE.AUTHENTICATE" });
  }

  const { grant_type, username, password } = req.body;

  if (grant_type !== "password") {
    return res
      .status(400)
      .json({ code: "9999" });
  }
  if (!username || !password) {
    return res
      .status(400)
      .json({ code: "100", name: "SECURITY.INVALID_USER" });
  }

  let user;
  try {
    user = await users.getUserByUsername(username);
  } catch (err) {
    console.error("Failed to read DB:", err);
    return res.status(500).json({ error: "server_error" });
  }

  if (!user || !(await verifyPassword(password, user.password))) {
    limiter.recordFailure(req.ip);
    return res.status(401).json({ code: "100", name: "SECURITY.INVALID_USER" });
  }

  if (!isHashed(user.password)) {
    await users.updatePassword(user.swid, await hashPassword(password));
  }

  limiter.clearFailures(req.ip);

  const allowedBands = ["CHILD", "TEEN", "ADULT"];
  const ageBand = allowedBands.includes(user.ageBand) ? user.ageBand : "ADULT";

  const access_token = token.createSession(user.swid);
  const refresh_token = token.randomIntToken();

  return res.json({
    ageBand,
    access_token,
    refresh_token,
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    username: user.username,
    displayName: user.displayName || user.first_name || user.username,
    swid: user.swid ?? null,
  });
});

module.exports = router;
