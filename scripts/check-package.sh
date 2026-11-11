#!/bin/sh
# Checks that a zip from `nx run desktop:package` is what that build promises. Needs macOS and the
# repo's dependencies. The app must be:
# - arm64, signed ad hoc with a signature that holds, with the hardened runtime and exactly the
#   entitlements in apps/desktop/build/entitlements.plist;
# - set with every fuse the build sets, read back from the binary;
# - an asar of only the build's output (dist/ and package.json), whose header hash is the one in
#   Info.plist, which Electron checks as it loads the asar;
# - registered, with the Viewer role, for `lo:` links and web links;
# - quitting at once, saying why, when started with a command-line switch.
# Usage: sh scripts/check-package.sh <zip>
set -euf
zip=${1:?usage: check-package.sh <zip>}
zip=$(CDPATH='' cd -- "$(dirname -- "$zip")" && pwd)/$(basename -- "$zip")
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
status=0
fail() {
  echo "$zip: $1" >&2
  status=1
}

ditto -x -k "$zip" "$work"
app=$work/Lo.app
plist=$app/Contents/Info.plist

architectures=$(lipo -archs "$app/Contents/MacOS/Lo")
[ "$architectures" = arm64 ] || fail "the app is built for \"$architectures\", not arm64"

codesign --verify --deep --strict "$app" || fail "the signature doesn't hold"
signature=$(codesign --display --verbose=2 "$app" 2>&1) || fail "the app isn't signed"
case $signature in
  *"(adhoc,runtime)"*) ;;
  *) fail "the app isn't signed ad hoc with the hardened runtime" ;;
esac

# plutil -p lists each entitlement on a line, so sorted lines compare them without their order.
entitlements=$(codesign --display --entitlements - --xml "$app" 2> /dev/null | plutil -p - | sort) ||
  fail "the entitlements can't be read"
expected=$(plutil -p apps/desktop/build/entitlements.plist | sort)
[ "$entitlements" = "$expected" ] || fail "the entitlements aren't the file's: $entitlements"

fuses=$(pnpm --silent --filter @lo/desktop exec electron-fuses read --app "$app") ||
  fail "the fuses can't be read"
for fuse in \
  'RunAsNode is Disabled' \
  'EnableNodeOptionsEnvironmentVariable is Disabled' \
  'EnableNodeCliInspectArguments is Disabled' \
  'OnlyLoadAppFromAsar is Enabled' \
  'EnableEmbeddedAsarIntegrityValidation is Enabled' \
  'EnableCookieEncryption is Enabled' \
  'GrantFileProtocolExtraPrivileges is Disabled'; do
  printf '%s\n' "$fuses" | grep -qxF -- "  $fuse" || fail "the fuse isn't set: $fuse"
done

# Electron hashes the asar's header (SHA-256), and compares it with Info.plist's as it loads the asar.
integrity='ElectronAsarIntegrity.Resources/app\.asar'
recorded=$(plutil -extract "$integrity.hash" raw -o - "$plist") || fail "Info.plist holds no hash of the asar"
algorithm=$(plutil -extract "$integrity.algorithm" raw -o - "$plist") || algorithm=
[ "$algorithm" = SHA256 ] || fail "Info.plist's asar hash is \"$algorithm\", not SHA256"
header=$(pnpm --silent --filter @lo/desktop exec node -e "
const { getRawHeader } = require('@electron/asar');
const { createHash } = require('node:crypto');
const { headerString } = getRawHeader(process.argv[1]);
console.log(createHash('sha256').update(headerString).digest('hex'));
" "$app/Contents/Resources/app.asar") || fail "the asar's header can't be hashed"
[ "$header" = "$recorded" ] || fail "the asar's header hashes to $header, and Info.plist says $recorded"
files=$(pnpm --silent --filter @lo/desktop exec asar list "$app/Contents/Resources/app.asar") ||
  fail "the asar can't be listed"
extra=$(printf '%s\n' "$files" | grep -vE '^/(dist(/|$)|package\.json$)' || true)
[ -z "$extra" ] || fail "the asar holds more than dist/ and package.json: $(echo "$extra" | head -3)"
for file in /dist/main/index.js /dist/preload/index.cjs /dist/window/index.html; do
  printf '%s\n' "$files" | grep -qxF -- "$file" || fail "the asar lacks $file"
done

# Each scheme must be in a URL type whose role is Viewer. plutil's keypaths index an array.
for scheme in lo http https; do
  found=
  i=0
  while role=$(plutil -extract "CFBundleURLTypes.$i.CFBundleTypeRole" raw -o - "$plist" 2> /dev/null); do
    schemes=$(plutil -extract "CFBundleURLTypes.$i.CFBundleURLSchemes" json -o - "$plist")
    case $schemes in
      *\"$scheme\"*) [ "$role" != Viewer ] || found=1 ;;
    esac
    i=$((i + 1))
  done
  [ -n "$found" ] || fail "Info.plist doesn't register $scheme with the Viewer role"
done

# A packaged Lo takes no command-line switches, so each of these must end it with status 1 and its
# reason, long before the limit. One that kept it running would have opened a port or a window.
refuses() {
  log=$work/refused.log
  CFFIXED_USER_HOME=$work/home "$app/Contents/MacOS/Lo" "$1" > "$log" 2>&1 &
  pid=$!
  (sleep 10 && kill -9 "$pid" 2> /dev/null) &
  watchdog=$!
  code=0
  wait "$pid" || code=$?
  { kill "$watchdog" && wait "$watchdog"; } 2> /dev/null || true
  if [ "$code" -ne 1 ] || ! grep -q 'Lo takes no command-line switches' "$log"; then
    fail "started with $1, Lo ended with status $code instead of refusing it"
  fi
}
for switch in --remote-debugging-port=0 -remote-debugging-pipe --ignore-certificate-errors \
  '--host-resolver-rules=MAP api.github.com 127.0.0.1:9'; do
  refuses "$switch"
done

[ "$status" -eq 0 ] && echo "$zip passed: arm64, ad hoc with the hardened runtime, fuses, asar and links, and it refuses switches."
exit "$status"
