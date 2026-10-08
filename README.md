<h1 align="center">ReInfinity</h1>
<p align="center"><i>A reimplementation of Disney Infinity's servers to bring back Toybox share and more.</i></p>

This project aims to accurately provide an HTTP API and plugins/tweaks for Disney Infinity games 1.0/2.0/3.0 on various platforms to restore functionality which became inaccessible after the original Disney servers were shut down.
> **Disclaimer:** This repository is a fan-made project. It is not affiliated with or endorsed by Disney or partners and all associated names, and distinct properties are the sole property of Disney.

## Getting Started
To begin running the ReInfinity server on your own device, follow these steps below. You can find build and installation steps for client plugins/tweaks further below.

### Prerequisites
- [npm](https://nodejs.org/):
  ```sh
  npm install npm@latest -g
  ```

### Installation
#### Server
1. Clone the repository
   ```sh
   git clone https://github.com/finthetechguy/ReInfinity
   ```
2. In the root of the repo, install NPM packages
   ```sh
   npm install
   ```
3. (Optional) Copy the `config.example.json` file and name it `config.json`. View config keys at [CONFIG](CONFIG.md).
4. Start the server
   ```sh
   node index
   ```

#### Game
**Coming soon...**

## Compatibility
ReInfinity plans to support almost all platforms which relied on online features, and all 3 editions of the game. Currently, only Disney Infinity **1.0** is supported.
You can find the latest updates in compatibility at [COMPATIBILITY](COMPATIBILITY.md).

## License
Distributed under MIT license, see [LICENSE](LICENSE.md).

### AI Use Disclosure
AI tools (LLMs) are used in this project for development and research, however generated code is heavily human-monitored, tested and extensively tested to ensure the code is safe and reliable. Any code that has not been fully tested will be explicitly marked as so, such as in [COMPATIBILITY](COMPATIBILITY.md).
