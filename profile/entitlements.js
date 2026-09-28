// Entitlements are only used by iOS, Android and APPX clients.

const express = require("express");
const token = require("../authentication/token");

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
const GRANTED_ITEMS = Object.fromEntries(
  [...LOCK_UIDS.map((uid) => LOCK_ID_BASE + uid), ...PRODUCT_IDS].map((id) => [id, 1])
);

//1.0 client only decrypts 200 bodies, so it reads this JSON as plain text
router.get("/:platform", token.authenticateToken, (req, res) => {
  res.status(203).json({
    _id: String(req.user.swid),
    inventory_items: GRANTED_ITEMS
  });
});

module.exports = router;
