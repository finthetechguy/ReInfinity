const express = require("express");
const users = require("../db/users");
const { hashPassword } = require("./password");

const router = express.Router();
const token = require("./token");

function getAgeBand(dob) {
    const yearDif = new Date().getFullYear() - new Date(dob).getFullYear();
    if (yearDif < 13) return "CHILD";
    if (yearDif < 18) return "TEEN";
    return "ADULT";
}

// Return the age group based on date of birth
router.get("/compliance", (req, res) => {
    res.json({
        ageBand: getAgeBand(req.query.dob)
    });
});

router.post("/create", async (req, res) => {
    const userData = req.body;

    if (!userData || typeof userData !== "object") {
        return res.status(400).json({ code: "9999" });
    }

    // Sanity checks for important data, game displays the error
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
    
    // Before @ part of the email will act as the username if not supplied
    // The email is also still added so it can still be used as a login option
    let newUsername = userData.username || userData.email.split("@")[0];

    let newUser = {
        username: newUsername,
        password: await hashPassword(userData.password),
        first_name: userData.first_name,
        last_name: userData.last_name || "null",
        displayName: userData.displayName || userData.first_name,
        email: userData.email || null,
        parents_email: userData.parents_email || null,
        ageBand: userData.date_of_birth ? getAgeBand(userData.date_of_birth) : "ADULT"
    }

    try {
        newUser = await users.createUser(newUser);
    } catch (err) {
        if (err.code === "SQLITE_CONSTRAINT" && err.message.includes("users.username")) {
            return res
                .status(400)
                .json({ code: "1", name: "APP.USERNAME_ALREADY_EXISTS" });
        }
        if (err.code === "SQLITE_CONSTRAINT" && err.message.includes("users.email")) {
            return res
                .status(400)
                .json({ code: "1", name: "APP.EMAIL_ALREADY_EXISTS" });
        }
        console.error("Failed to create user:", err);
        return res.status(500).json({ code: "9999" });
    }

    const access_token = token.randomIntToken();
    const refresh_token = token.randomIntToken();
    token.activeSessions[access_token] = newUser.swid;

    res.json({
        ageBand: newUser.ageBand,
        access_token,
        refresh_token,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        username: newUser.username,
        displayName: newUser.displayName,
        swid: newUser.swid
    });
});

module.exports = router;