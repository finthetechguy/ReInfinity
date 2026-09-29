# ReInfinity Wii U plugin

An [Aroma](https://aroma.foryour.cafe/) plugin that connects Disney Infinity 1.0 (Wii U) to a ReInfinity (or any other) server. It patches the game in memory when it starts and it doesn't modify the game files itself.

What it patches:
- **Config URL:** `https://api.disney.com/infinity/config/v1/wiiu/` -> `http://<server>:<port>/infinity/config/v1/wiiu/`. The server's response supplies every other URL for different services.
- **Nintendo Network checks** (optional): As Nintendo Network has shut down and Pretendo (currently) refuses the client ID for Disney Infinity, it will produce an error and therefore prevent connecting to the HTTP API. This bypasses this check allowing to connect to ReInfinity but **not** multiplayer.

Disney Infinity 2.0 and 3.0 should be supported in the future.

## Install
Needs Aroma from April 2026 or later (WUPS 0.9.1), ensure your Aroma install is up-to-date, you can do so in the Aroma Updater app.

You will also need Disney INFINITY (USA) and the latest version (v49) installed.

1. Copy `ReInfinity.wps` to `sd:/wiiu/environments/aroma/plugins/`.
2. On the Wii U, open the plugin menu (**L + Down + SELECT** on the GamePad) and select **ReInfinity**, and set the server (IP or domain) and port.
3. Start Disney Infinity. A notification at the top left shows the URL in use, or an error if something couldn't be patched.

Changes apply the next time the game starts.

Settings are saved to `sd:/wiiu/environments/aroma/plugins/config/reinfinity.json`, which can also be edited on a PC. Allow the server's port through the PC's firewall. If parental controls are on, the Wii U needs online communication allowed.

## Build
Requires devkitPPC, wut, [WUPS](https://github.com/wiiu-env/WiiUPluginSystem), [libkernel](https://github.com/wiiu-env/libkernel) and [libnotifications](https://github.com/wiiu-env/libnotifications). Install the first two with devkitPro's pacman, then run `make install` in a clone of each of the other three. With `DEVKITPRO` and `DEVKITPPC` env vars set run:

```bash
make
```