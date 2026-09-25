const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const router = express.Router();
const NEWS_FILE = path.join(__dirname, "newsItems.json");

router.get("/", async (_req, res) => {
  try {
    const data = await fs.readFile(NEWS_FILE, "utf8");
    const json = JSON.parse(data);
    res.json(json);
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).json({ error: "newsItems.json not found" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to read newsItems.json" });
  }
});

module.exports = router;