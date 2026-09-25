// /json/json.js
const { Router } = require("express");
const path = require("path");
const fs = require("fs/promises");

const router = Router();
const INFINITY1 = path.join(__dirname, "endpointList-IN1.json");
const INFINITY2 = path.join(__dirname, "endpointList-IN2.json");

async function serveEndpointList(res, jsonFile) {
    try {
        const data = await fs.readFile(jsonFile, "utf8");
        const json = JSON.parse(data);
        res.json(json);
    } catch (err) {
        if (err.code === "ENOENT") {
            return res.status(404);
        }
        console.error(err);
        res.status(500);
    }
}

router.get("/ios", async (_req, res) => {
    serveEndpointList(res, INFINITY1);
});

router.get("/win8rt", async (_req, res) => {
    serveEndpointList(res, INFINITY1)
});

router.get("/infinity2/ios", async (_req, res) => {
    serveEndpointList(res, INFINITY2);
});



module.exports = router;
