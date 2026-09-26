const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

// Only failed logins are counted.
const failures = new Map();

function getEntry(ip) {
    const entry = failures.get(ip);
    if (entry && entry.resetAt <= Date.now()) {
        failures.delete(ip);
        return null;
    }
    return entry;
}

function isLocked(ip) {
    const entry = getEntry(ip);
    return Boolean(entry) && entry.count >= MAX_FAILURES;
}

function recordFailure(ip) {
    const entry = getEntry(ip);
    if (entry) {
        entry.count++;
    } else {
        failures.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
    }
}

function clearFailures(ip) {
    failures.delete(ip);
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of failures) {
        if (entry.resetAt <= now) failures.delete(ip);
    }
}, WINDOW_MS).unref();

module.exports = {
    isLocked,
    recordFailure,
    clearFailures
};
