const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const router = express.Router();
const NEWS_FILE = path.join(__dirname, "newsItems.json");
const MAX_PAGE_SIZE = 50;

function parsePositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : fallback;
}

function toArticle(item) {
  const article = { title: String(item?.title ?? ""), body: String(item?.body ?? "") };
  if (typeof item?.image === "string" && item.image && item.image !== "null") {
    article.image = item.image;
  }
  return article;
}

router.get("/:sku/:language", async (req, res) => {
  let items;
  try {
    items = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  } catch (err) {
    console.error("Failed to read newsItems.json:", err);
    return res.status(500).json({ error: "Failed to read newsItems.json" });
  }
  if (!Array.isArray(items)) {
    console.error("newsItems.json must contain an array");
    return res.status(500).json({ error: "newsItems.json must contain an array" });
  }

  // Pages start at 1, an unknown page gets 404
  const page = req.query.page === undefined ? 1 : parsePositiveInt(req.query.page, 0);
  const pageSize = Math.min(parsePositiveInt(req.query.page_size, 1), MAX_PAGE_SIZE);
  const pageCount = Math.ceil(items.length / pageSize);
  if (page < 1 || page > pageCount) {
    return res.status(404).json({ error: "Page not found" });
  }

  const start = (page - 1) * pageSize;
  res.json({
    page,
    page_count: pageCount,
    items: items.slice(start, start + pageSize).map(toArticle)
  });
});

module.exports = router;
