const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const config = require("./util/config");
const { initUsersDb } = require("./db/users");
const { createConfigRouter } = require("./endpoints/endpoints");
const loginRouter = require("./authentication/login");
const signupRouter = require("./authentication/signup");
const platformsRouter = require("./profile/platforms");
const newsRouter = require("./news/news");
const avatarRouter = require("./profile/avatar");
const toyboxRouter = require("./ugc/toybox");

const app = express();

// Middleware

app.use((req, res, next) => {
  const now = new Date().toISOString();
  console.log(`[${now}] ${req.method} ${req.originalUrl} from ${req.ip}`);
  next();
});

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Static files

app.get("/mobilenetwork/referralstore/bootstrap", (req, res) => {
  res.sendFile(path.join(__dirname, "assets/mobilepage/index.html"));
});

// Test
app.get("/assets/avatars/default.png", async (req, res) => {
  const image = await fs.readFile(path.join(__dirname, "assets/avatars/default.png"));
  res.set({
    "Content-Type": "image/png",
    "Content-Length": String(image.length),
    "Cache-Control": "no-store",
    "Connection": "close",
    "Accept-Ranges": "none"
  });
  res.end(image);
});

// Services

app.use("/infinity/config/v1/", createConfigRouter("in1"));
app.use("/coregames/config/v1/", createConfigRouter("in2"));
app.use("/auth/authenticate", loginRouter);
app.use("/auth", signupRouter);
app.use("/profile/platforms", platformsRouter);
app.use("/news/IOS/en-US", newsRouter);
app.use("/profile/avatar", avatarRouter);
app.use("/ugc", toyboxRouter);

app.get("/", (req, res) => {
  res.type("text").send("Use on Disney Infinity client!");
});

// Startup

initUsersDb()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Server listening on port ${config.port}`);
      if (config.publicBaseUrl) {
        console.log(`Service URLs use ${config.publicBaseUrl}`);
      } else {
        console.log("Service URLs use the address of this server");
      }
    });
  })
  .catch((err) => {
    console.error("Failed to open users DB:", err);
    process.exit(1);
  });
