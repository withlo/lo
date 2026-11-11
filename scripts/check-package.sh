#!/bin/sh
# Checks that a zip from `nx run desktop:package` is what that build promises. Needs macOS and the
# repo's dependencies. The app must be:
# - arm64, signed ad hoc with a signature that holds, with the hardened runtime and exactly the
#   entitlements in apps/desktop/build/entitlements.plist;
# - set with every fuse the build sets, read back from the binary;
# - an asar of only the build's output (dist/ and package.json), with Electron's hash of it in
#   Info.plist;
# - registered, with the Viewer role, for `lo:` links and web links.
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

plutil -extract 'ElectronAsarIntegrity.Resources/app\.asar.hash' raw -o - "$plist" > /dev/null ||
  fail "Info.plist holds no hash of the asar"
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

[ "$status" -eq 0 ] && echo "$zip passed: arm64, ad hoc with the hardened runtime, fuses, asar and links."
exit "$status"
