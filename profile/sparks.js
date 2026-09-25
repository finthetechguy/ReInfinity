const express = require("express");
const { requireAuth } = require("../authentication/requireAuth");

const router = express.Router();

//router.use(requireAuth);

router.get("/", (req, res) => {
  res.json({
    code: 0
  });
});

module.exports = router;