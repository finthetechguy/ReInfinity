function getBaseUrl(req) {
    const override = process.env.PUBLIC_BASE_URL;
    if (override) {
        return override.replace(/\/+$/, "");
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
