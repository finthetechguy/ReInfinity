const express = require("express");
const users = require("../db/users");

const router = express.Router();

// Return the age group based on date of birth
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

// A random 8 digit number generator to create a swid
function generateSwid() {
    const min = 10000000;
    const max = 99999999;

    const randNum = Math.floor(Math.random() * (max - min +1)) + min;
    return randNum;
}

router.post("/create", async (req, res) => {
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

    try {
        await users.createUser(newUser);
    } catch (err) {
        if (err.code === "SQLITE_CONSTRAINT" && err.message.includes("users.username")) {
            return res
                .status(400)
                .json({ code: "1", name: "INUSE_VALUE.USERNAME" });
        }
        console.error("Failed to create user:", err);
        return res.status(500).json({ code: "9999" });
    }

    res.json(newUser);
});

module.exports = router;