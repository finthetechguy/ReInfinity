const express = require("express");

const router = express.Router();
const token = require("./token");
const users = require("../db/users");
const { disneyError } = require("../util/disneyErrors");

router.use(express.json({ type: "*/*" }));

// The game resends a request that got "401 Invalid token"
router.post("/", async (req, res) => {
    const refreshToken = req.body?.refresh_token;
    if (typeof refreshToken !== "string" || !refreshToken) {
        return res.status(400).json(disneyError("INPUT.MISSING_DATA.REFRESH_TOKEN"));
    }

    const swid = await token.useRefreshToken(refreshToken);
    const user = swid ? await users.getUserBySwid(swid) : null;
    if (!user) {
        console.log("Token refresh rejected: unknown or expired refresh token");
        return token.sendInvalidToken(res);
    }

    const access_token = token.createSession(user.swid);
    const refresh_token = await token.createRefreshToken(user.swid);
    console.log(`Token refreshed for ${user.username}`);

    // both tokens must be strings
    return res.json({ access_token: String(access_token), refresh_token });
});

module.exports = router;
