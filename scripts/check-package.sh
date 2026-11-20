#!/bin/sh
# Checks that a build of Lo for the Mac is what its config promises. Needs macOS and the repo's
# dependencies, and an Intel build's launch checks need Rosetta.
#
# Given a zip from `nx run desktop:package`, it checks that the app is arm64, signed ad hoc with a
# signature that holds, with the hardened runtime and exactly the entitlements in
# apps/desktop/build/entitlements.plist, and holds no app-update.yml, so it never looks for updates.
#
# With --release, given a DMG or a zip from the release config (apps/desktop/build/release.yml),
# named Lo-<version>-<arch>.<dmg|zip> as that config names it, it checks that the app is:
# - built for that architecture, with that version in Info.plist, and a minimum macOS no older than
#   the one its Electron is built for;
# - holding an app-update.yml that names GitHub Releases of withlo/lo, and nothing else;
# - signed with a Developer ID, which names a team and chains to Apple's root, with a secure
#   timestamp and the hardened runtime, as is each of its helpers, each with exactly the
#   entitlements in apps/desktop/build/entitlements.release.plist;
# - notarized, as Gatekeeper says, with its ticket stapled to it.
# A DMG must hold only the app and a link to /Applications, and be signed by the same team and
# notarized, as Gatekeeper says for a disk image opened. Its ticket isn't stapled.
#
# With --release --ad-hoc, it checks the release config built ad hoc, as a dry run builds it:
# everything --release does but the Developer ID and notarization, with an ad hoc signature and
# the entitlements in apps/desktop/build/entitlements.plist.
#
# Every app must also be:
# - set with every fuse the build sets, read back from the binary;
# - an asar of only the build's output (dist/ and package.json), whose header hash is the one in
#   Info.plist, which Electron checks as it loads the asar;
# - registered, with the Viewer role, for `lo:` links and web links;
# - quitting at once, saying why, when started with anything but a link, a switch after whitespace
#   included, or with a variable set that would write out or expose its traffic, such as
#   SSLKEYLOGFILE;
# - never reading the test servers' manifest LO_TEST_SERVERS names, nor asking the update feed
#   LO_UPDATES_FEED names for anything: only a build run from source uses either.
# Usage: sh scripts/check-package.sh <zip>
#        sh scripts/check-package.sh --release [--ad-hoc] <dmg or zip>
set -euf
release=
adhoc=true
if [ "${1-}" = --release ]; then
  release=true
  adhoc=
  shift
  if [ "${1-}" = --ad-hoc ]; then
    adhoc=true
    shift
  fi
fi
if [ $# -ne 1 ]; then
  echo 'usage: check-package.sh [--release [--ad-hoc]] <dmg or zip>' >&2
  exit 2
fi
file=$(CDPATH='' cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
name=$(basename -- "$file")

# What the file must hold: the package is always an arm64 zip, and a release says in its name.
if [ -n "$release" ]; then
  case $name in
    Lo-?*-arm64.dmg | Lo-?*-arm64.zip | Lo-?*-x64.dmg | Lo-?*-x64.zip) ;;
    *)
      echo "$file: a release is named Lo-<version>-<arm64|x64>.<dmg|zip>" >&2
      exit 2
      ;;
  esac
  format=${name##*.}
  rest=${name%.*}
  arch=${rest##*-}
  rest=${rest%-*}
  version=${rest#Lo-}
else
  format=zip
  arch=arm64
fi
case $arch in
  arm64) machine=arm64 ;;
  *) machine=x86_64 ;;
esac

cd "$(dirname "$0")/.."
work=$(mktemp -d)
volume=
listener=
trap '
  [ -z "$listener" ] || kill "$listener" 2> /dev/null || true
  [ -z "$volume" ] || hdiutil detach -quiet -force "$volume" 2> /dev/null || true
  rm -rf "$work"
' EXIT
status=0
fail() {
  echo "$file: $1" >&2
  status=1
}

app=$work/Lo.app
plist=$app/Contents/Info.plist
if [ "$format" = dmg ]; then
  volume=$work/volume
  mkdir "$volume"
  if ! hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$volume" "$file" \
    > "$work/attach.log" 2>&1; then
    cat "$work/attach.log" >&2
    volume=
    echo "$file: the DMG doesn't mount" >&2
    exit 1
  fi
  # Leaving out the hidden files that lay out its window (.background.tiff, .DS_Store and the like).
  contents=$(find "$volume" -mindepth 1 -maxdepth 1 ! -name '.*' | sed 's|.*/||' | sort | tr '\n' ' ')
  [ "$contents" = 'Applications Lo.app ' ] ||
    fail "the DMG holds more than Lo.app and a link to /Applications: $contents"
  [ "$(readlink "$volume/Applications")" = /Applications ] ||
    fail "the DMG's Applications isn't a link to /Applications"
  ditto "$volume/Lo.app" "$app"
  hdiutil detach -quiet "$volume"
  volume=
else
  ditto -x -k "$file" "$work"
fi

architectures=$(lipo -archs "$app/Contents/MacOS/Lo")
[ "$architectures" = "$machine" ] || fail "the app is built for \"$architectures\", not $machine"

if [ -n "$release" ]; then
  for key in CFBundleShortVersionString CFBundleVersion; do
    value=$(plutil -extract "$key" raw -o - "$plist" 2> /dev/null) || value=
    [ "$value" = "$version" ] || fail "Info.plist's $key is \"$value\", not $version"
  done
fi

# macOS won't open an app on a system older than Info.plist's minimum, and Electron's framework
# won't run on one older than the minimum it's built for.
minimum=$(plutil -extract LSMinimumSystemVersion raw -o - "$plist" 2> /dev/null) || minimum=
framework="$app/Contents/Frameworks/Electron Framework.framework/Electron Framework"
built=$(xcrun vtool -show-build "$framework" | awk '$1 == "minos" { print $2; exit }') || built=
if [ -z "$minimum" ] || [ -z "$built" ]; then
  fail "the minimum macOS can't be read: \"$minimum\" in Info.plist, \"$built\" for Electron"
elif [ "$(printf '%s\n%s\n' "$minimum" "$built" | sort -V | head -n 1)" != "$built" ]; then
  fail "Info.plist lets macOS $minimum open the app, and its Electron needs $built or later"
fi

# electron-updater reads where updates come from in app-update.yml, which only the release config
# writes: anything else there could send it elsewhere.
update=$app/Contents/Resources/app-update.yml
if [ -n "$release" ]; then
  expected=$(printf '%s\n' 'owner: withlo' 'provider: github' 'repo: lo' 'updaterCacheDirName: lo-updater')
  if [ ! -f "$update" ]; then
    fail "the app holds no app-update.yml"
  elif [ "$(sort "$update")" != "$expected" ]; then
    fail "app-update.yml names more than GitHub Releases of withlo/lo: $(cat "$update")"
  fi
else
  [ ! -e "$update" ] || fail "the app holds an app-update.yml, so it would look for updates"
fi

codesign --verify --deep --strict "$app" || fail "the signature doesn't hold"

# Checks that $1, named $2 in messages, is signed with a Developer ID that names a team and chains
# to Apple's root, with a secure timestamp, and the hardened runtime unless $3 is `any`. Sets team
# to the team it names.
team=
developer_id() {
  team=
  shown=$(codesign --display --verbose=2 "$1" 2>&1) || {
    fail "$2 isn't signed"
    return 0
  }
  authorities=$(printf '%s\n' "$shown" | sed -n 's/^Authority=//p')
  team=$(printf '%s\n' "$shown" | sed -n 's/^TeamIdentifier=//p')
  case $team in
    [A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]) ;;
    *) fail "$2's signature names no team: \"$team\"" ;;
  esac
  case $(printf '%s\n' "$authorities" | sed -n 1p) in
    "Developer ID Application: "*" ($team)") ;;
    *) fail "$2 isn't signed with a Developer ID Application certificate of its team: $authorities" ;;
  esac
  chain=$(printf '%s\n' 'Developer ID Certification Authority' 'Apple Root CA')
  [ "$(printf '%s\n' "$authorities" | sed 1d)" = "$chain" ] ||
    fail "$2's certificate doesn't chain to Apple's root through Developer ID: $authorities"
  # A secure timestamp, from Apple's server, which notarization requires. An insecure one shows as
  # "Signed Time".
  printf '%s\n' "$shown" | grep -q '^Timestamp=' || fail "$2's signature has no secure timestamp"
  if [ "${3-}" != any ]; then
    case $shown in
      *"flags=0x10000(runtime)"*) ;;
      *) fail "$2 isn't signed with the hardened runtime alone: $(printf '%s\n' "$shown" | grep flags=)" ;;
    esac
  fi
}

if [ -n "$adhoc" ]; then
  signature=$(codesign --display --verbose=2 "$app" 2>&1) || fail "the app isn't signed"
  case $signature in
    *"(adhoc,runtime)"*) ;;
    *) fail "the app isn't signed ad hoc with the hardened runtime" ;;
  esac
  entitlements=apps/desktop/build/entitlements.plist
else
  developer_id "$app" 'the app'
  signer=$team
  entitlements=apps/desktop/build/entitlements.release.plist
fi

# The app and each helper, with exactly the file's entitlements, and with a release, each helper
# signed by the app's team. plutil -p lists each entitlement on a line, so sorted lines compare
# them without their order.
expected=$(plutil -p "$entitlements" | sort)
codes=$(
  printf '%s\n' "$app"
  find "$app/Contents/Frameworks" -maxdepth 1 -name '*.app' | sort
)
spaces=$IFS
IFS='
'
for code in $codes; do
  label=$(basename "$code" .app)
  if [ -z "$adhoc" ] && [ "$code" != "$app" ]; then
    developer_id "$code" "$label"
    [ -z "$team" ] || [ "$team" = "$signer" ] ||
      fail "$label is signed by team $team, and the app by $signer"
  fi
  found=$(codesign --display --entitlements - --xml "$code" 2> /dev/null | plutil -p - | sort) ||
    found='none'
  [ "$found" = "$expected" ] || fail "$label's entitlements aren't $entitlements's: $found"
done
IFS=$spaces

if [ -z "$adhoc" ]; then
  # Gatekeeper's verdict on the app as it would run it, and on the DMG as it would open it. The
  # DMG's ticket isn't stapled, so spctl asks Apple for it.
  assessment=$(spctl --assess -vv --type exec "$app" 2>&1) || true
  case $assessment in
    *"source=Notarized Developer ID"*) ;;
    *) fail "Gatekeeper doesn't take the app as notarized: $assessment" ;;
  esac
  xcrun stapler validate -q "$app" || fail "the app has no notarization ticket stapled to it"
  if [ "$format" = dmg ]; then
    codesign --verify --strict "$file" || fail "the DMG's signature doesn't hold"
    developer_id "$file" 'the DMG' any
    [ -z "$team" ] || [ "$team" = "$signer" ] ||
      fail "the DMG is signed by team $team, and the app by $signer"
    assessment=$(spctl --assess -vv --type open --context context:primary-signature "$file" 2>&1) ||
      true
    case $assessment in
      *"source=Notarized Developer ID"*) ;;
      *) fail "Gatekeeper doesn't take the DMG as notarized: $assessment" ;;
    esac
  fi
fi

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
entries=$(pnpm --silent --filter @lo/desktop exec asar list "$app/Contents/Resources/app.asar") ||
  fail "the asar can't be listed"
extra=$(printf '%s\n' "$entries" | grep -vE '^/(dist(/|$)|package\.json$)' || true)
[ -z "$extra" ] || fail "the asar holds more than dist/ and package.json: $(echo "$extra" | head -3)"
for entry in /dist/main/index.js /dist/preload/index.cjs /dist/window/index.html; do
  printf '%s\n' "$entries" | grep -qxF -- "$entry" || fail "the asar lacks $entry"
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

# The rest start Lo, which an Intel build does only through Rosetta, and far more slowly: on a CI
# runner, a copy's first start has taken over two minutes, as Rosetta translates it, and each later
# one over ten seconds. $limit is how long a start may take.
if [ "$machine" = x86_64 ]; then
  if ! arch -x86_64 /usr/bin/true 2> /dev/null; then
    fail "starting an Intel build needs Rosetta, which isn't installed: softwareupdate --install-rosetta"
    exit 1
  fi
  limit=300
else
  limit=30
fi

# Runs "$@", Lo as some launch would start it, and succeeds when Lo ends with status 1, saying $1,
# within $limit seconds. One that kept it running would have opened a port, a window or a
# connection.
ends_saying() {
  said=$1
  shift
  log=$work/refused.log
  "$@" > "$log" 2>&1 &
  pid=$!
  # Stopped early, the watchdog stops its sleep too, which would otherwise hold the output open.
  (
    trap 'kill "$sleeper" 2> /dev/null; exit 0' TERM
    sleep "$limit" &
    sleeper=$!
    wait "$sleeper" && kill -9 "$pid" 2> /dev/null
  ) &
  watchdog=$!
  code=0
  wait "$pid" || code=$?
  { kill "$watchdog" && wait "$watchdog"; } 2> /dev/null || true
  [ "$code" -eq 1 ] && grep -q "$said" "$log"
}

# A packaged Lo takes no command-line arguments but links, so each of these must end it with its
# reason: switches, those Chromium still reads after the whitespace it trims among them, and a file.
tab=$(printf '\t')
for switch in --remote-debugging-port=0 -remote-debugging-pipe --ignore-certificate-errors \
  '--host-resolver-rules=MAP api.github.com 127.0.0.1:9' " --ssl-key-log-file=$work/keys.log" \
  "$tab--log-net-log=$work/net.json" "$work/x.txt"; do
  ends_saying 'Lo takes no command-line arguments but links' \
    env CFFIXED_USER_HOME="$work/home" "$app/Contents/MacOS/Lo" "$switch" ||
    fail "started with \"$switch\", Lo ended with status $code instead of refusing it"
done

# Nor the variables that do what some switches do, such as SSLKEYLOGFILE, which has Chromium write
# out the secrets of every connection to GitHub.
for variable in "SSLKEYLOGFILE=$work/keys.log" ELECTRON_ENABLE_LOGGING=1 \
  "ELECTRON_LOG_FILE=$work/chromium.log" NODE_TLS_REJECT_UNAUTHORIZED=0; do
  ends_saying "Lo won't start with" \
    env "$variable" CFFIXED_USER_HOME="$work/home" "$app/Contents/MacOS/Lo" ||
    fail "started with $variable, Lo ended with status $code instead of refusing it"
done
[ ! -e "$work/keys.log" ] || fail "started with SSLKEYLOGFILE or --ssl-key-log-file, Lo wrote to it"
[ ! -e "$work/net.json" ] || fail "started with --log-net-log, Lo wrote to it"

# Nor does it read a manifest of test servers, or ask an update feed other than GitHub's.
# LO_TEST_SERVERS names a pipe, which a writer waits to open until something opens it to read, and
# LO_UPDATES_FEED a feed on a port of 127.0.0.1 where a listener notes every connection. Lo, run
# until it has opened its database and started its features, and 10 seconds more, does neither.
node=$(pnpm --silent --filter @lo/desktop exec node -p process.execPath)
"$node" -e "
const { appendFileSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const [port, connections] = process.argv.slice(1);
const server = createServer((socket) => {
  appendFileSync(connections, 'connection\n');
  socket.destroy();
});
server.listen(0, '127.0.0.1', () => writeFileSync(port, String(server.address().port)));
" "$work/feed.port" "$work/feed.connections" &
listener=$!
i=0
while [ ! -s "$work/feed.port" ] && [ "$i" -lt 100 ]; do
  sleep 0.1
  i=$((i + 1))
done
port=$(cat "$work/feed.port")
manifest=$work/servers.json
mkfifo "$manifest"
env LO_TEST_SERVERS="$manifest" LO_UPDATES_FEED="http://127.0.0.1:$port/" \
  CFFIXED_USER_HOME="$work/home" "$app/Contents/MacOS/Lo" > "$work/variables.log" 2>&1 &
lo=$!
(printf '{ "servers": [] }\n' > "$manifest" && touch "$work/servers.read") &
writer=$!
database="$work/home/Library/Application Support/Lo/lo.db"
waited=0
while [ ! -e "$database" ] && [ "$waited" -lt "$limit" ] && kill -0 "$lo" 2> /dev/null; do
  sleep 1
  waited=$((waited + 1))
done
[ ! -e "$database" ] || sleep 10
if kill -0 "$lo" 2> /dev/null; then
  kill "$lo" && wait "$lo" || true
else
  fail "started with LO_TEST_SERVERS and LO_UPDATES_FEED, Lo ended before its features had started"
fi
{ kill "$writer" && wait "$writer"; } 2> /dev/null || true
{ kill "$listener" && wait "$listener"; } 2> /dev/null || true
listener=
[ -e "$database" ] ||
  fail "started with LO_TEST_SERVERS and LO_UPDATES_FEED, Lo hadn't opened its database in $limit seconds"
[ ! -e "$work/servers.read" ] || fail "started with LO_TEST_SERVERS, Lo read the manifest it names"
[ ! -s "$work/feed.connections" ] || fail "started with LO_UPDATES_FEED, Lo asked the feed it names"

if [ "$status" -eq 0 ]; then
  if [ -z "$release" ]; then
    echo "$file passed: arm64, ad hoc with the hardened runtime, no update feed, fuses, asar and links, it refuses switches, files and variables, and it reads no test servers or feed."
  elif [ -n "$adhoc" ]; then
    echo "$file passed: $arch, $version, ad hoc with the hardened runtime, GitHub's update feed, fuses, asar and links, it refuses switches, files and variables, and it reads no test servers or other feed."
  else
    echo "$file passed: $arch, $version, a Developer ID of team $signer with the hardened runtime, notarized and stapled, GitHub's update feed, fuses, asar and links, it refuses switches, files and variables, and it reads no test servers or other feed."
  fi
fi
exit "$status"
