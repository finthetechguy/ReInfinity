#!/usr/bin/env bash
# Signs a PRX as an SPRX with scetool (the Windows build in TrueAncestor, which has the keys).
# Usage: sign.sh <game|vsh> <in.prx> <out.sprx>
# Both use APP key revision 0x0A, the newest APP key with a public private key.
#   game: the SELF header of Sony's libusbd.sprx (auth ID 0x1070000040000001, version 4.90,
#         control flags ...01).
#   vsh:  the header webMAN MOD's VSH plugin uses (auth ID 0x1070000052000001, version 1.0,
#         firmware 3.40, control flags 40...02).
set -euo pipefail

profile=$1
in=$2
out=$3
SCETOOL_DIR=${SCETOOL_DIR:-/mnt/c/Users/Fin/Downloads/TrueAncestor_SELF_Resigner_v1.96}

case $profile in
game)
	header=(--self-auth-id=1070000040000001 --self-app-version=0004009000000000
		--self-fw-version=0003005500000000
		--self-ctrl-flags=0000000000000000000000000000000000000000000000000000000000000001)
	;;
vsh)
	header=(--self-auth-id=1070000052000001 --self-app-version=0001000000000000
		--self-fw-version=0003004000000000
		--self-ctrl-flags=4000000000000000000000000000000000000000000000000000000000000002)
	;;
*)
	echo "sign.sh: unknown profile '$profile' (game or vsh)" >&2
	exit 1
	;;
esac

# scetool.exe can't read \\wsl$ paths reliably, so work in the Windows temp folder.
win_tmp=$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/ReInfinityPS3
mkdir -p "$win_tmp"
cp "$in" "$win_tmp/sign_in.prx"
rm -f "$win_tmp/sign_out.sprx"

# scetool looks for data/keys relative to the current folder.
(cd "$SCETOOL_DIR" && ./tool/scetool.exe \
	--sce-type=SELF --compress-data=TRUE --skip-sections=FALSE --key-revision=0A \
	--self-vendor-id=01000002 --self-type=APP "${header[@]}" \
	--encrypt "$(wslpath -w "$win_tmp/sign_in.prx")" "$(wslpath -w "$win_tmp/sign_out.sprx")") |
	tr -d '\r' | grep -v '^$'

cp "$win_tmp/sign_out.sprx" "$out"
echo "signed ($profile): $out"
