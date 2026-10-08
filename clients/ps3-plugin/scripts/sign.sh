#!/usr/bin/env bash
# Signs a PRX as an SPRX with scetool.
# Usage: sign.sh <game|vsh> <in.prx> <out.sprx>
# scetool is $SCETOOL, or scetool on the PATH. It reads its keys from data/ in $SCETOOL_DIR (or
# from its PS3 env var). Under WSL with no native scetool, $SCETOOL_DIR/tool/scetool.exe is used,
# e.g. in TrueAncestor SELF Resigner.
# Both use APP key revision 0x0A, the newest APP key with a public private key.
#   game: the SELF header of Sony's libusbd.sprx (auth ID 0x1070000040000001, version 4.90,
#         control flags ...01).
#   vsh:  the header webMAN MOD's VSH plugin uses (auth ID 0x1070000052000001, version 1.0,
#         firmware 3.40, control flags 40...02).
set -euo pipefail

profile=$1
in=$2
out=$3
SCETOOL_DIR=${SCETOOL_DIR:-.}

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

options=(--sce-type=SELF --compress-data=TRUE --skip-sections=FALSE --key-revision=0A
	--self-vendor-id=01000002 --self-type=APP "${header[@]}")

scetool=${SCETOOL:-$(command -v scetool || true)}
if [[ -n $scetool ]]; then
	[[ $scetool == */* ]] && scetool=$(realpath "$scetool")
	in_abs=$(realpath "$in")
	out_abs=$(realpath -m "$out")
	rm -f "$out_abs"
	# scetool looks for data/keys relative to the current folder.
	(cd "$SCETOOL_DIR" && "$scetool" "${options[@]}" --encrypt "$in_abs" "$out_abs") | { grep -v '^$' || true; }
	if [[ ! -s $out_abs ]]; then
		echo "sign.sh: scetool didn't write $out" >&2
		# naehrwert's scetool can't parse a keys file with Windows line endings.
		if grep -q $'\r' "$SCETOOL_DIR/data/keys" 2>/dev/null; then
			echo "sign.sh: $SCETOOL_DIR/data/keys has Windows line endings; convert it with dos2unix" >&2
		fi
		exit 1
	fi
elif [[ -x $SCETOOL_DIR/tool/scetool.exe ]] && command -v wslpath >/dev/null; then
	# scetool.exe can't read \\wsl$ paths reliably, so work in the Windows temp folder.
	win_tmp=$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/ReInfinityPS3
	mkdir -p "$win_tmp"
	cp "$in" "$win_tmp/sign_in.prx"
	rm -f "$win_tmp/sign_out.sprx"
	(cd "$SCETOOL_DIR" && ./tool/scetool.exe "${options[@]}" \
		--encrypt "$(wslpath -w "$win_tmp/sign_in.prx")" "$(wslpath -w "$win_tmp/sign_out.sprx")") |
		tr -d '\r' | { grep -v '^$' || true; }
	cp "$win_tmp/sign_out.sprx" "$out"
else
	echo "sign.sh: scetool not found. Put it on the PATH or set SCETOOL, and set SCETOOL_DIR to the" >&2
	echo "folder holding its data/keys (see README.md)." >&2
	exit 1
fi
echo "signed ($profile): $out"
