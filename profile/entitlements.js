// Entitlements are only used by iOS, Android and APPX clients.

const express = require("express");
const token = require("../authentication/token");
const config = require("../util/config");
const users = require("../db/users");
const { normaliseCode } = require("../util/redeemCode");

const router = express.Router();

// The client unlocks item ID 5,000,000 + UID as the lock with that UID
const LOCK_ID_BASE = 5000000;

function range(first, last) {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

const LOCK_UIDS = [
  80430,                                          // IAP_ULTIMATE_TOYBOX
  ...range(78890, 78926), 82788,                  // IGP characters
  ...range(80384, 80429),                         // IGP_COIN_* Toy Box items
  ...range(80265, 80270), ...range(80545, 80550)  // IGP play sets and their item packs
];

const PRODUCT_IDS = [
  2000001,                    // Starter pack
  ...range(1000001, 1000038)  // Character figures
];

// Keyed by item ID because the client ignores array elements and it also rejects bodies of 2048+ bytes.
const ALL_ITEMS = [...LOCK_UIDS.map((uid) => LOCK_ID_BASE + uid), ...PRODUCT_IDS];
const itemIds = config.entitlements === "all" ? ALL_ITEMS : config.entitlements;
const GRANTED_ITEMS = Object.fromEntries(itemIds.map((id) => [id, 1]));

const REDEEM_CODES = new Map(config.redeemCodes.map((entry) => [entry.code, entry]));

// A player who redeemed every code must still get a body under the client's limit, so check the worst case at startup.
const allRedeemable = config.redeemCodes.flatMap((entry) => entry.items);
const worstCase = JSON.stringify({ _id: "00000000", inventory_items: Object.fromEntries([...itemIds, ...allRedeemable].map((id) => [id, 1])) });
if (worstCase.length > config.ENTITLEMENTS_MAX_BYTES) {
  console.error(`Config error: entitlements plus every redeemCodes item would make a ${worstCase.length} byte response, the game's limit is ${config.ENTITLEMENTS_MAX_BYTES}`);
  process.exit(1);
}

//1.0 client only decrypts 200 bodies, so it reads this JSON as plain text
router.get("/:platform", token.authenticateToken, async (req, res) => {
  const items = { ...GRANTED_ITEMS };
  for (const { code } of await users.getRedeemedCodes(req.user.swid)) {
    for (const id of REDEEM_CODES.get(code)?.items ?? []) items[id] = 1;
  }
  res.status(203).json({
    _id: String(req.user.swid),
    inventory_items: items
  });
});

const REDEEM_ERRORS = {
  UNKNOWN: "40004",
  EXPIRED: "40003",
  INACTIVE: "40940",
  ALREADY_REDEEMED: "40902",
  USED_BY_OTHER: "40903",
  LIMIT_REACHED: "40930",
  BAD_REQUEST: "40956"
};

function sendRedeemError(res, reason) {
  return res.status(203).json({ code: REDEEM_ERRORS[reason] });
}

router.post("/:platform/redeem", express.json({ type: "*/*" }), token.authenticateToken, async (req, res) => {
  const typed = req.body?.code;
  if (typeof typed !== "string" || !typed.trim()) {
    return sendRedeemError(res, "BAD_REQUEST");
  }

  const { swid, username } = req.user;
  const entry = REDEEM_CODES.get(normaliseCode(typed));
  let reason = null;
  if (!entry) {
    reason = "UNKNOWN";
  } else if (!entry.active) {
    reason = "INACTIVE";
  } else if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
    reason = "EXPIRED";
  } else if (await users.hasRedeemedCode(entry.code, swid)) {
    reason = "ALREADY_REDEEMED";
  } else if (!(await users.redeemCode(entry.code, swid, entry.maxUses))) {
    reason = entry.maxUses === 1 ? "USED_BY_OTHER" : "LIMIT_REACHED";
  }

  if (reason) {
    console.log(`Redeem code "${typed}" rejected for ${username}: ${reason}`);
    return sendRedeemError(res, reason);
  }

  console.log(`Redeem code ${entry.code} (${entry.name}) redeemed by ${username}`);
  return res.status(203).json({
    _id: String(swid),
    campaign: { key: entry.name },
    inventory_items_gained: Object.fromEntries(entry.items.map((id) => [id, 1]))
  });
});

module.exports = router;
