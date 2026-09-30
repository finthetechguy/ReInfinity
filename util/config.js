const fs = require("fs");
const path = require("path");
const { normaliseCode } = require("./redeemCode");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

const DEFAULTS = {
    port: 4,
    publicBaseUrl: null,
    entitlements: "all",
    consoleAccountLinking: false,
    redeemCodes: []
};

const ENTITLEMENTS_MAX_BYTES = 2047;

const ENV_VARS = {
    port: "PORT",
    publicBaseUrl: "PUBLIC_BASE_URL"
};

function readConfigFile() {
    let text;
    try {
        text = fs.readFileSync(CONFIG_PATH, "utf8");
    } catch (err) {
        if (err.code === "ENOENT") {
            console.log("No config.json found, using defaults (see config.example.json)");
            return {};
        }
        throw new Error(`Could not read config.json: ${err.message}`, { cause: err });
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw new Error(`config.json is not valid JSON: ${err.message}`, { cause: err });
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("config.json must contain a JSON object");
    }
    return parsed;
}

function validatePort(value) {
    const port = typeof value === "string" ? Number(value) : value;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`port must be a whole number from 1 to 65535, got ${JSON.stringify(value)}`);
    }
    return port;
}

function validatePublicBaseUrl(value) {
    if (value === null || value === "") {
        return null;
    }
    let url = null;
    if (typeof value === "string") {
        try {
            url = new URL(value);
        } catch {
            url = null;
        }
    }
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
        throw new Error(`publicBaseUrl must be an http:// or https:// URL, got ${JSON.stringify(value)}`);
    }
    return value.replace(/\/+$/, "");
}

function validateEntitlements(value) {
    if (value === "all") {
        return value;
    }
    if (!Array.isArray(value) || !value.every((id) => Number.isInteger(id) && id > 0)) {
        throw new Error(`entitlements must be "all" or an array of item IDs (whole numbers), got ${JSON.stringify(value)}`);
    }
    const ids = [...new Set(value)];
    const body = JSON.stringify({ _id: "00000000", inventory_items: Object.fromEntries(ids.map((id) => [id, 1])) });
    if (body.length > ENTITLEMENTS_MAX_BYTES) {
        throw new Error(`entitlements has too many items (${ids.length}): the response would be ${body.length} bytes, the game's limit is ${ENTITLEMENTS_MAX_BYTES}`);
    }
    return Object.freeze(ids);
}

function validateConsoleAccountLinking(value) {
    if (typeof value !== "boolean") {
        throw new Error(`consoleAccountLinking must be true or false, got ${JSON.stringify(value)}`);
    }
    return value;
}

function validateRedeemCodes(value) {
    if (!Array.isArray(value)) {
        throw new Error(`redeemCodes must be an array, got ${JSON.stringify(value)}`);
    }
    const seen = new Set();
    return Object.freeze(value.map((entry, i) => {
        const where = `redeemCodes[${i}]`;
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
            throw new Error(`${where} must be an object`);
        }
        const code = typeof entry.code === "string" ? normaliseCode(entry.code) : "";
        if (!/^[A-Z0-9]{1,12}$/.test(code)) {
            throw new Error(`${where}.code must be 1 to 12 letters or digits (dashes allowed), got ${JSON.stringify(entry.code)}`);
        }
        if (seen.has(code)) {
            throw new Error(`${where}.code "${entry.code}" is listed more than once`);
        }
        seen.add(code);

        const { items, name = entry.code, maxUses = null, expires = null, active = true } = entry;
        if (!Array.isArray(items) || !items.length || !items.every((id) => Number.isInteger(id) && id > 0)) {
            throw new Error(`${where}.items must be a non-empty array of item IDs (whole numbers)`);
        }
        if (typeof name !== "string" || !name) {
            throw new Error(`${where}.name must be a non-empty string`);
        }
        if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
            throw new Error(`${where}.maxUses must be a whole number of at least 1, got ${JSON.stringify(maxUses)}`);
        }
        const expiresAt = expires === null ? null : Date.parse(expires);
        if (Number.isNaN(expiresAt) || (expires !== null && typeof expires !== "string")) {
            throw new Error(`${where}.expires must be a date such as "2027-01-01", got ${JSON.stringify(expires)}`);
        }
        if (typeof active !== "boolean") {
            throw new Error(`${where}.active must be true or false, got ${JSON.stringify(active)}`);
        }

        const uniqueItems = [...new Set(items)];
        const body = JSON.stringify({ _id: "00000000", campaign: { key: name }, inventory_items_gained: Object.fromEntries(uniqueItems.map((id) => [id, 1])) });
        if (body.length > ENTITLEMENTS_MAX_BYTES) {
            throw new Error(`${where} has too many items: the response would be ${body.length} bytes, the game's limit is ${ENTITLEMENTS_MAX_BYTES}`);
        }
        return Object.freeze({ code, name, items: Object.freeze(uniqueItems), maxUses, expiresAt, active });
    }));
}

function loadConfig() {
    const file = readConfigFile();
    for (const key of Object.keys(file)) {
        if (!(key in DEFAULTS)) {
            console.warn(`Ignoring unknown config.json key "${key}"`);
        }
    }

    const merged = {};
    for (const key of Object.keys(DEFAULTS)) {
        const envValue = ENV_VARS[key] && process.env[ENV_VARS[key]];
        if (envValue) {
            merged[key] = envValue;
        } else if (key in file) {
            merged[key] = file[key];
        } else {
            merged[key] = DEFAULTS[key];
        }
    }

    return Object.freeze({
        port: validatePort(merged.port),
        publicBaseUrl: validatePublicBaseUrl(merged.publicBaseUrl),
        entitlements: validateEntitlements(merged.entitlements),
        consoleAccountLinking: validateConsoleAccountLinking(merged.consoleAccountLinking),
        redeemCodes: validateRedeemCodes(merged.redeemCodes)
    });
}

let config;
try {
    config = loadConfig();
} catch (err) {
    console.error(`Config error: ${err.message}`);
    process.exit(1);
}

module.exports = config;
