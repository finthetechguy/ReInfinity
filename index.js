const express = require("express");
const path = require("path");

const endpointRouter = require("./endpoints/endpoints");
const loginRouter = require("./authentication/login");
const signupRouter = require("./authentication/signup");
const platformsRouter = require("./profile/platforms");
const newsRouter = require("./news/news");
const avatarRouter = require("./profile/avatar");
const toyboxRouter = require("./ugc/toybox");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 4;

// app.use(
//   "/assets",
//   express.static(path.join(__dirname, "assets"), {
//     fallthrough: false,
//     maxAge: "1h",
//     immutable: true
//   })
// );

app.get("/mobilenetwork/referralstore/bootstrap", (req, res) => {
  res.sendFile(path.join(__dirname, "assets/mobilepage/index.html"));
});

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const fs = require('fs');
app.get('/assets/avatars/default.png', (req, res) => {
  const buf = fs.readFileSync('/Users/finle/Documents/ReInfinity/assets/avatars/default.png');
  res.status(200);
  res.set({
    'Content-Type': 'image/png',
    'Content-Length': String(buf.length),
    'Cache-Control': 'no-store',           // disable validators entirely
    'Connection': 'close',
    'Accept-Ranges': 'none'
  });

  // Make absolutely sure nothing sets Content-Encoding
  res.removeHeader('Content-Encoding');
  res.end(buf);
});


app.use((req, res, next) => {
  const now = new Date().toISOString();
  console.log(`[${now}] ${req.method} ${req.originalUrl} from ${req.ip}`);
  next();
});

app.use("/infinity/config/v1/", endpointRouter);
app.use("/coregames/config/v1/", endpointRouter);
app.use("/auth/authenticate", loginRouter);
app.use("/auth", signupRouter);
app.use("/profile/platforms", platformsRouter);
app.use("/news/IOS/en-US", newsRouter);
app.use("/profile/avatar", avatarRouter);
app.use("/ugc", toyboxRouter);

app.get("/", (req, res) => {
  res.type("text").send("Use on Disney Infinity client!");
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
