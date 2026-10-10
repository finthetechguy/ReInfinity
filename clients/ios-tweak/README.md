# ReInfinity iOS tweak

A jailbreak tweak that connects Disney Infinity 1.0 and 2.0 (iOS) to a ReInfinity (or any other) server. It hooks onto the networking API the game uses and doesn't modify any game files.

What it does:
- **Redirects API host:** requests to `https://api.disney.com/...` get redirected to `http://<server>:<port>/...` instead, with the path and query unchanged. This covers the config URL (`/infinity/config/v1/ios/` for 1.0, `/coregames/config/v1/infinity2/ios/` for 2.0), whose response supplies every other service URL, and any other URL which uses that domain anyway regardless of the config response.

2.0 (`com.disney.disneyinfinity2`) is untested. 3.0 should be supported in the future.

## Install
Needs a jailbroken device on iOS 6.0 or later with Cydia Substrate and PreferenceLoader. Tested on an iOS 10.3.3 with Disney Infinity 1.0, version 1.5 (`com.disney.DisneyInfinity`).

1. Copy the `.deb` to the device and install it, for example by opening it in Filza, or with `dpkg -i com.reinfinity.ios_1.1.0_iphoneos-arm.deb` as root.
2. Open **Settings > ReInfinity**, enter the server's IP address or domain and set the port.
3. If Disney Infinity is already running, close it from the app switcher, then restart it.

Changes apply the next time the game starts.

## Settings
| Setting | Default | |
|---|---|---|
| Enabled | On | Off does not redirect requests. |
| Server | (empty) | Server IP address or domain. |
| Port | `8080` | The server's port. |
| Use HTTPS | Off | Only for servers behind HTTPS with a valid certificate. |

Settings are saved to `/var/mobile/Library/Preferences/com.reinfinity.ios.plist`.

## Limitations
- Private ToyBox Share doesn't work yet on iOS, as the game checks a signature on those responses.
- Rootful jailbreaks only (32-bit needs iOS 10 or earlier anyway).

## Build
Needs [Theos](https://theos.dev) in `~/theos` with the `iPhoneOS9.3.sdk`. Then run:

```bash
./build.sh
```

The `.deb` is placed in `packages/`. It also adds a `liblaunch.tbd` stub that the theos SDK is missing.