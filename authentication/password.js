const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

const PREFIX = "scrypt:";
const KEY_LENGTH = 64;

// Stored as "scrypt:<salt hex>:<hash hex>" and tells non hashed passwords apart
async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(String(password), salt, KEY_LENGTH);
    return `${PREFIX}${salt.toString("hex")}:${hash.toString("hex")}`;
}

function isHashed(stored) {
    return typeof stored === "string" && stored.startsWith(PREFIX);
}

function safeEqual(a, b) {
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function verifyPassword(password, stored) {
    if (!isHashed(stored)) {
        return safeEqual(Buffer.from(String(password)), Buffer.from(String(stored)));
    }

    const [saltHex, hashHex] = stored.slice(PREFIX.length).split(":");
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(String(password), Buffer.from(saltHex, "hex"), expected.length);
    return safeEqual(actual, expected);
}

module.exports = {
    hashPassword,
    isHashed,
    verifyPassword
};
