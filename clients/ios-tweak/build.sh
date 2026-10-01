#!/usr/bin/env bash
# Build the tweak and put the .deb in ./packages/.
set -euo pipefail

: "${THEOS:=$HOME/theos}"
export THEOS

SRC="$(cd "$(dirname "$0")" && pwd)"
BUILD="${TMPDIR:-/tmp}/reinf-ios-tweak-build"

# The theos/sdks iPhoneOS9.3 SDK is missing the liblaunch stub that libSystem re-exports at 6.0 deployment target
LAUNCH_TBD="$THEOS/sdks/iPhoneOS9.3.sdk/usr/lib/system/liblaunch.tbd"
if [[ ! -e "$LAUNCH_TBD" ]]; then
	echo "==> Adding liblaunch.tbd stub to SDK"
	cat > "$LAUNCH_TBD" <<'TBD'
---
archs:                 [ armv7, armv7s, arm64, i386, x86_64 ]
platform:              ios
install-name:          /usr/lib/system/liblaunch.dylib
current-version:       0
compatibility-version: 1
...
TBD
fi

rm -rf "$BUILD"
mkdir -p "$BUILD"
rsync -a --exclude '.theos' --exclude 'packages' "$SRC/" "$BUILD/"

make -C "$BUILD" clean >/dev/null 2>&1 || true
make -C "$BUILD" package FINALPACKAGE=1

mkdir -p "$SRC/packages"
cp -f "$BUILD"/packages/*.deb "$SRC/packages/"
echo "==> Copied to $SRC/packages/:"
ls -1 "$SRC/packages/"*.deb
