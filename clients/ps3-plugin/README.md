# ReInfinity PS3 plugin

A plugin for PS3 consoles with CFW that connects Disney Infinity 1.0 (PS3) to a ReInfinity (or any other) server. It patches the game in memory when it starts, and it doesn't modify the game files.

It has two parts: `reinfinity_vsh.sprx` runs on XMB from boot then it waits for Disney Infinity to start, then loads `reinfinity_game.sprx` into the game. It also hosts a settings page to change host, port, etc.

What the game module patches:
- **Redirects API host:** requests to `https://api.disney.com/...` go to `http://<server>:<port>/...` instead, with the path and query unchanged. This covers the config URL (`/infinity/config/v1/ps3/`), which response supplies every other service URL.
- **PSN checks** (optional): the game won't access the server unless the user is signed in to PSN. When enabled, the game is told it's signed in, and its network check asks for the network only, not PSN. A console that actually is signed in is unaffected. This allows connecting to ReInfinity but **not** multiplayer.

Disney Infinity 2.0 and 3.0 should be supported in the future.

## Install
Needs a PS3 on custom firmware with Cobra (which includes PS3MAPI). Tested on Evilnat CFW with Disney Infinity (USA `BLUS30977`) and update 02.01. Note: The EU release (`BLES01843`) should also work but hasn't been tested. PS3HEN has not been tested either.

1. Copy the `dev_hdd0` folder from `ReInfinity-PS3.zip` once built to the PS3 over FTP or another way. This puts both `.sprx` files in `/dev_hdd0/reinfinity/`.
2. Add this line to `/dev_hdd0/boot_plugins.txt` (`boot_plugins_hen.txt` on HEN) or create the file if it doesn't exist.
   ```
   /dev_hdd0/reinfinity/reinfinity_vsh.sprx
   ```
3. Restart the PS3.
4. Open the settings page, `http://<ps3-ip>:8090/`, in a browser on the same network, or `http://127.0.0.1:8090/` in the PS3 browser.
5. Enter the server's IP address or domain and its port, then select **Save**.
6. Start Disney Infinity. A notification shows the URL in use, or an error if something went wrong.

Changes apply the next time the game starts.

## Settings
| Setting | Default | |
|---|---|---|
| Redirect | On | Off does not redirect requests from the game. |
| Server | (empty) | Server IP address or domain. |
| Port | `8080` | The server's port. |
| PSN check bypass | On | Lets the game go online without signing into PSN. |

Settings are saved to `/dev_hdd0/reinfinity/config.txt`, which can also be edited over FTP (`config.example.txt` lists all keys).

## Limitations
- No multiplayer.
- Without a PSN sign-in, the game can only log in to ReInfinity with a username and password.
- HTTP only as the PS3's SSL is too old for current certificates.
- The settings page has no password, make sure that port (8090) isn't exposed.

## Build
Needs Linux with: `gcc-powerpc64-linux-gnu` `binutils-powerpc64-linux-gnu` `make` `python3` `zip`.

Signing needs [scetool](https://github.com/naehrwert/scetool). Put `scetool` on the `PATH` (or set `SCETOOL` to it), and set `SCETOOL_DIR` to the folder that holds `data/`. Then run:

```bash
SCETOOL_DIR=<scetool-path> make package
```

This places `ReInfinity-PS3.zip` in `build/` and the same files in `build/package/`. `make` builds unsigned `.prx` files only.

The `keys` file needs Unix line endings, so convert one from Windows with `dos2unix`.

For WSL, `SCETOOL_DIR` can instead point at a TrueAncestor SELF Resigner folder, whose `tool/scetool.exe` is used when no Linux `scetool` is found.
