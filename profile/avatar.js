const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const DB_PATH = path.join(__dirname, "..", "db", "users.json");

function loadUsers() {
  const raw = fs.readFileSync(DB_PATH, "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data.users) ? data.users : [];
}

router.get("/guest/:swid/image", (req, res) => {
  const swidParam = String(req.params.swid || "").trim();
  if (!swidParam) {
    return res.status(400).json({ code: "bad_request", message: "Missing swid." });
  }

  let users;
  try {
    users = loadUsers();
  } catch (err) {
    console.error("Failed to read users DB:", err);
    return res.status(500).json({ code: "server_error" });
  }

  const user = users.find(u => String(u.swid) === swidParam);
  if (!user) {
    return res.status(404).json({ code: "not_found", message: "Player not found." });
  }

  const image  = user.image  ?? "http://192.168.0.18:3000/assets/avatars/default.png";
  const width  = Number.isFinite(user.width)  ? user.width  : 256;
  const height = Number.isFinite(user.height) ? user.height : 256;

  return res.status(200).json({ image, width, height });
});

module.exports = router;