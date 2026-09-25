const express = require("express");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "db", "users.json");

const router = express.Router();

// Return the age group based on date of birth (and country code)
router.get("/compliance", (req, res) => {
    // const countryCode = req.query.country-code;
    const queryDate = new Date(req.query.dob);
    const currentDate = new Date();
    let calcAgeBand;

    const yearDif = currentDate.getFullYear() - queryDate.getFullYear();

    // TODO: Use month and day to make the calculation more accurate
    if (yearDif < 13) { calcAgeBand = "CHILD"; }
    else if (yearDif < 18) { calcAgeBand = "TEEN"; }
    else { calcAgeBand = "ADULT"; }

    res.json({
        ageBand: calcAgeBand
    });
});

// A random 8 digit number generator to act as our SWID
function generateSwid() {
    const min = 10000000;
    const max = 99999999;

    const randNum = Math.floor(Math.random() * (max - min +1)) + min;
    return randNum;
}

// Adds user account to database, returns JSON with any errors
// Only first name, last name and email are required (for now)
router.post("/create", (req, res) => {
    const userData = req.body;

    if (!userData || typeof userData !== "object") {
        return res.status(400).json({ code: "9999" });
    }

    // Sanity checks for important data, game handles error
    if (!userData.first_name) {
        return res
            .status(400)
            .json({ code: "1", name: "INPUT.MISSING_DATA.FIRST_NAME" });
    }
    if (!userData.password) {
        return res
            .status(400)
            .json({ code: "1", name: "INPUT.MISSING_DATA.PASSWORD" });
    }
    if (!userData.username) {
        if (!userData.email) {
            return res
                .status(400)
                .json({ code: "1", name: "INPUT.MISSING_DATA.EMAIL" });
        }
    }
    
    let newEmail = userData.email || userData.parents_email;
    // Before @ part of the email will act as the username if not supplied
    // The email is also still added so it can still be used as a login option
    let newUsername = userData.username || userData.email.split("@")[0];

    const newUser = {
        username: newUsername,
        password: userData.password,
        first_name: userData.first_name,
        last_name: userData.last_name || "null",
        displayName: userData.displayName || userData.first_name,
        email: newEmail || "null",
        swid: userData.swid || generateSwid()
    }

    fs.readFile(DB_PATH, "utf8", (err, data) => {
        if (err) return res.status(500).json({ code: "9999" });

        let db = JSON.parse(data);
        db.users.push(newUser);

        fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), (writeErr) => {
            if (writeErr) return res.status(500).json({ code: "9999" });
            res.json(newUser);
        });
    });
});

module.exports = router;