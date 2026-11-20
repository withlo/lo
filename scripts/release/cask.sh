#!/bin/sh
# Writes Lo's Homebrew cask, `Casks/lo.rb` in withlo/homebrew-tap, to standard output: lo.rb.in, beside
# this script, with a release's version and the SHA-256 of its two DMGs filled in. The release
# workflow's cask job runs it once a release is published, and CI renders it with fixed values for
# `brew style`. The version follows version.sh's rules (semver.sh), without the tag's v, and each
# SHA-256 is 64 lowercase hex digits, as `sha256sum` writes it; anything else is refused, so nothing
# but those reaches the cask.
#
# The template takes the rest from the repository: the app's name and bundle ID from
# apps/desktop/build/electron-builder.yml, its minimum macOS from build/release.yml, and what `zap`
# removes from where Lo keeps its data (cask.test.ts checks them against the configs):
# - /private/var/folders/*/*/C/Lo: Lo's cache, in the folder macOS keeps for the user's caches
#   (`getconf DARWIN_USER_CACHE_DIR`), which holds the repositories' copies and language servers;
# - ~/.config/lo: the keymap, settings.json and themes;
# - ~/Library/Application Support/Lo: Electron's userData, with Lo's database;
# - ~/Library/Caches/lo-updater: where electron-updater downloads to (release.yml names it);
# - ~/Library/Caches/<bundle ID>.ShipIt and ~/Library/Preferences/ByHost/<bundle ID>.ShipIt.*.plist:
#   what Squirrel.Mac, which installs the updates of a Lo installed from a DMG, keeps for ShipIt,
#   its installer, under the label `<bundle ID>.ShipIt`;
# - the Preferences and Saved Application State macOS keeps by the bundle ID.
# A Lo that Homebrew installed never downloads its own updates: it gives the brew command instead.
# So by the Cask Cookbook it doesn't update itself, and the cask has no `auto_updates`.
# Usage: sh scripts/release/cask.sh <version> <arm64 DMG's SHA-256> <x64 DMG's SHA-256>
set -euf
if [ $# -ne 3 ]; then
  echo 'usage: cask.sh <version> <arm64 sha256> <x64 sha256>' >&2
  exit 2
fi
version=$1
arm64=$2
x64=$3
here=$(dirname -- "$0")
refuse() {
  echo "$1" >&2
  exit 1
}

# shellcheck source=scripts/release/semver.sh
. "$here/semver.sh"
is_release_version "$version" ||
  refuse "$version isn't a SemVer version without build metadata or a v, such as 0.1.0 or 0.1.0-rc.1."

# Succeeds when $1 is a SHA-256 as sha256sum writes it, on one line.
is_sha256() {
  case $1 in
    *'
'*) return 1 ;;
  esac
  printf '%s\n' "$1" | LC_ALL=C grep -Eqx '[0-9a-f]{64}'
}
is_sha256 "$arm64" || refuse "The arm64 DMG's SHA-256 isn't 64 lowercase hex digits."
is_sha256 "$x64" || refuse "The x64 DMG's SHA-256 isn't 64 lowercase hex digits."

# None of the three holds a character sed would read in a replacement: \, & or |.
sed -e "s|@VERSION@|$version|g" -e "s|@ARM64_SHA256@|$arm64|g" -e "s|@X64_SHA256@|$x64|g" \
  "$here/lo.rb.in"
