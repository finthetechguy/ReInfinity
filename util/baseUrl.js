const config = require("./config");

function getBaseUrl(req) {
    if (config.publicBaseUrl) {
        return config.publicBaseUrl;
    }

    const host = req.get("host");
    if (host) {
        return `${req.protocol}://${host}`;
    }

    // HTTP/1.0 clients might not include Host so fall back to the address the request arrived on.
    let address = req.socket.localAddress.replace(/^::ffff:/, "");
    if (address.includes(":")) {
        address = `[${address}]`;
    }
    return `${req.protocol}://${address}:${req.socket.localPort}`;
}

module.exports = { getBaseUrl };
