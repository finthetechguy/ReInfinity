const { Router } = require("express");
const { GAMES, buildServiceList } = require("./serviceList");
const { getBaseUrl } = require("../util/baseUrl");

function createConfigRouter(game) {
    if (!GAMES[game]) {
        throw new Error(`Unknown game "${game}"`);
    }

    const router = Router();

    // platforms can contain slashes ("infinity2/ios") and the client adds a trailing one.
    router.get("/{*platform}", (req, res) => {
        const platform = (req.params.platform || []).filter(Boolean).join("/");
        if (!GAMES[game].platforms.includes(platform)) {
            console.warn(`Unknown ${game} config platform "${platform}" from ${req.ip}`);
            return res.status(404).json({ code: "404", name: "CONFIG.UNKNOWN_PLATFORM" });
        }

        res.json(buildServiceList(game, getBaseUrl(req)));
    });

    return router;
}

module.exports = { createConfigRouter };
