const express = require("express");

const router = express.Router();

// Country lookup a client makes before signup
const LOCALE_BODY = [
  "geoDecoder.country.name=United States",
  "geoDecoder.country.isoCode=USA"
].join("\n");

router.get("/GetDE", (_req, res) => {
  res.type("text/plain").send(LOCALE_BODY);
});

module.exports = router;
