const users = require("../db/users");
const config = require("../util/config");

// Console account IDs are sent as assertion_id
// TODO: Figure out the other console formats like PS3, X360
const PLATFORM_ID_FORMATS = {
    wiiu: /^(?!00000000)[0-9A-F]{8}$/ // Nintendo Network principal ID
};

function getConsoleAccount(body) {
    const platform = body?.assertion_platform;
    const id = body?.assertion_id;
    if (typeof platform !== "string" || typeof id !== "string") return null;
    const format = Object.hasOwn(PLATFORM_ID_FORMATS, platform) ? PLATFORM_ID_FORMATS[platform] : null;
    if (!format || !format.test(id)) return null;
    return { platform, id };
}

async function findLinkedUser(body) {
    const account = config.consoleAccountLinking ? getConsoleAccount(body) : null;
    if (!account) return null;
    return users.getUserByConsoleAccount(account.platform, account.id);
}

async function linkFromBody(body, user) {
    const account = config.consoleAccountLinking ? getConsoleAccount(body) : null;
    if (!account) return;
    try {
        const previous = await users.getUserByConsoleAccount(account.platform, account.id);
        if (previous?.swid === user.swid) return;
        await users.linkConsoleAccount(account.platform, account.id, user.swid);
        const moved = previous ? ` (moved from ${previous.username})` : "";
        console.log(`Linked ${account.platform} account ${account.id} to ${user.username}${moved}`);
    } catch (err) {
        console.error(`Failed to link ${account.platform} account ${account.id}:`, err);
    }
}

module.exports = {
    getConsoleAccount,
    findLinkedUser,
    linkFromBody
};
