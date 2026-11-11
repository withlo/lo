#!/bin/sh
# Checks that a zip from `nx run desktop:package` is what that build promises: an arm64 app, signed
# ad hoc with a signature that holds, and registered for `lo:` links and web links. Needs macOS.
# Usage: sh scripts/check-package.sh <zip>
set -euf
zip=${1:?usage: check-package.sh <zip>}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
status=0
fail() {
  echo "$zip: $1" >&2
  status=1
}

ditto -x -k "$zip" "$work"
app=$work/Lo.app

codesign --verify --deep --strict "$app" || fail "the signature doesn't hold"
signature=$(codesign --display --verbose=2 "$app" 2>&1) || fail "the app isn't signed"
case $signature in
  *Signature=adhoc*) ;;
  *) fail "the app isn't signed ad hoc" ;;
esac

architectures=$(lipo -archs "$app/Contents/MacOS/Lo")
[ "$architectures" = arm64 ] || fail "the app is built for \"$architectures\", not arm64"

# Info.plist's URL types, as JSON on one line: each scheme is a quoted string.
schemes=$(plutil -extract CFBundleURLTypes json -o - "$app/Contents/Info.plist")
for scheme in lo http https; do
  case $schemes in
    *\"$scheme\"*) ;;
    *) fail "Info.plist doesn't register $scheme" ;;
  esac
done

[ "$status" -eq 0 ] && echo "$zip is an ad hoc signed arm64 build that registers lo, http and https."
exit "$status"
