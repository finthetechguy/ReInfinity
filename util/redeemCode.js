function normaliseCode(code) {
    return String(code).toUpperCase().replace(/[\s-]/g, "");
}

module.exports = { normaliseCode };
