// Codes and messages from 1.0 binary.
const CODES = {
    "1": [
        "INPUT.MISSING_DATA.UNKNOWN",
        "INPUT.MISSING_DATA.CLIENT_ID",
        "INPUT.MISSING_DATA.GRANT_TYPE",
        "INPUT.MISSING_DATA.USERNAME",
        "INPUT.MISSING_DATA.PASSWORD",
        "INPUT.MISSING_DATA.ASSERTION_PLATFORM",
        "INPUT.MISSING_DATA.ASSERTION_ID",
        "INPUT.MISSING_DATA.PLATFORM_TOKEN",
        "INPUT.MISSING_DATA.REFRESH_TOKEN",
        "INPUT.MISSING_DATA.REGION",
        "INPUT.INVALID_REGION_SIZE",
        "INPUT.MISSING_DATA.FIRST_NAME",
        "INPUT.MISSING_DATA.LAST_NAME",
        "INPUT.MISSING_DATA.DOB",
        "INPUT.MISSING_DATA.EMAIL",
        "APP.EMAIL_REQUIRED",
        "APP.INVALID_EMAIL_FORMAT",
        "APP.INVALID_EMAIL_SIZE",
        "APP.INVALID_FIRST_NAME_SIZE",
        "APP.INVALID_LAST_NAME_SIZE",
        "APP.INVALID_USERNAME",
        "APP.INVALID_USERNAME_FOR_CHILD",
        "APP.INVALID_USERNAME_SIZE",
        "APP.INVALID_PASSWORD",
        "APP.PASSWORD_INVALID_SIZE",
        "APP.INVALID_DATE_OF_BIRTH"
    ],
    "100": [
        "SECURITY.INVALID_USER",
        "SECURITY.FAILED_PLATFORM_AUTHORIZATION",
        "SECURITY.PERMISSION_LOGIN_REQUIRED",
        "SECURITY.PERMISSION_LOGIN_DENIED"
    ],
    "110": [
        "APP.CLIENT_ID_UNKNOWN",
        "APP.GRANT_TYPE_UNKNOWN",
        "APP.ASSERTION_PLATFORM_UNKNOWN",
        "APP.ACCOUNT_NOT_LINKED"
    ],
    "200": [
        "SYSTEM.UNRESPONSIVE.AUTHENTICATE",
        "SYSTEM.UNRESPONSIVE.COMPLIANCE",
        "SYSTEM.UNRESPONSIVE.ACCOUNT_MAPPING",
        "SYSTEM.UNRESPONSIVE.PROFILE"
    ],
    "2001": ["APP.EMAIL_ADDRESS_EXISTS"],
    "2002": ["APP.USERNAME_ALREADY_EXISTS"]
};

const CODE_BY_NAME = new Map();
for (const [code, names] of Object.entries(CODES)) {
    for (const name of names) {
        CODE_BY_NAME.set(name, code);
    }
}

// Returns the error body for a name
function disneyError(name) {
    const code = CODE_BY_NAME.get(name);
    if (!code) {
        throw new Error(`Unknown Disney error name "${name}"`);
    }
    return { code, name };
}

module.exports = { disneyError };
