const express = require("express");
const users = require("../db/users");
const { getBaseUrl } = require("../util/baseUrl");

const router = express.Router();

router.get("/guest/:swid/image", async (req, res) => {
  const swidParam = String(req.params.swid || "").trim();
  if (!swidParam) {
    return res.status(400).json({ code: "bad_request", message: "Missing swid." });
  }

  let user;
  try {
    user = await users.getUserBySwid(swidParam);
  } catch (err) {
    console.error("Failed to read users DB:", err);
    return res.status(500).json({ code: "server_error" });
  }

  if (!user) {
    return res.status(404).json({ code: "not_found", message: "Player not found." });
  }

  const image  = user.image  ?? `${getBaseUrl(req)}/assets/avatars/default.png`;
  const width  = Number.isFinite(user.width)  ? user.width  : 256;
  const height = Number.isFinite(user.height) ? user.height : 256;

  return res.status(200).json({ image, width, height });
});

module.exports = router;