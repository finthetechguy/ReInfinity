# Configuration
The ReInfinity server can be configurated using a `config.json` file, at the root of the server directory, or environment variables. **A default config file example is located at the root of the directory called `config.example.json`.**

## Values

### `port`
The port that the server is to be hosted on.
- Type: integer (or numeric string), 1–65535.
- Default: 4
- Can be overridden by the PORT environment variable.
- Example: "port": 8080

### `publicBaseUrl`
The base URL of the server.
- Type: null/"" (auto-detect), or http:// https:// URL string.
- Default: null
- Can be overridden by PUBLIC_BASE_URL environment variable.
- Examples:
  - "publicBaseUrl": null
  - "publicBaseUrl": "https://example.com"

### `entitlements`
Various items granted to the user, only used on iOS, Android and Windows Store platforms.
- Type: the string "all", or an array of positive integer item IDs.
- Default: "all"
- Whole set is capped so the resulting server response stays under 2047 bytes (ENTITLEMENTS_MAX_BYTES).
- Examples:
  - "entitlements": "all" - grant all entitlements.
  - "entitlements": [1000001, 1000002, 1000003] — grant only these item IDs.
 
### `redeemCodes`
Defining a web code which can be redeemed on iOS, Android or Windows Store platforms.
- Type: array of redeem-code objects. Each entry:
  - code (string, required): 1–12 letters/digits, dashes allowed and stripped. Must be unique in the list.
  - items (array of positive integers, required): item IDs granted by the code.
  - name (string, optional): defaults to the code itself.
  - maxUses (integer ≥ 1 or null, optional): limits redemptions; null = unlimited.
  - expires (date string or null, optional): e.g. "2027-01-01"; null = never expires.
  - active (boolean, optional): defaults to true; can it b eused.
- Example:
```
"redeemCodes": [
    { "code": "ABCD-EFGH-IJKL", "items": [1000001], "name": "Test" },
    { "code": "LIMITED1", "items": [1000002, 1000003], "maxUses": 100, "expires": "2027-01-01", "active": true }
]
```
