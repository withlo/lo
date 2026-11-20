#!/bin/sh
# Checks that a Linux package of Lo is what apps/desktop/build/release.yml promises: a deb or an rpm
# named Lo-<version>-<arch>.<deb|rpm>, as that config names it. Needs Linux, the repo's
# dependencies, dpkg-deb for a deb, and rpm, rpm2cpio, cpio and Docker for an rpm. It checks the
# package on a machine of the architecture it's for, since it installs and starts it: a deb here,
# through sudo, and an rpm in a Fedora container. Nothing it installs outlasts it.
#
# The package must be:
# - named lo, at the file's version and architecture, under GPL-3.0-only, with the maintainer,
#   homepage and libsecret among its dependencies, and build/linux/'s scripts as its own;
# - holding only Lo in /opt/Lo, its desktop file and its icons, with the program at /opt/Lo/lo,
#   and Chromium's sandbox helper setuid root in the package itself, and nothing else setuid or
#   setgid;
# - registering Lo, in its desktop file, for lo:// links and nothing else, opening it as
#   `/opt/Lo/lo %U`;
# - holding an app-update.yml that names GitHub Releases of withlo/lo, and electron-builder's
#   AppArmor profile for /opt/Lo/lo;
# - set with every fuse the build sets, read back from the program, with an asar of only the
#   build's output (dist/ and package.json), whose package.json names Lo's desktop file. Electron
#   checks no asar hash on Linux, so there's none to check.
# Installed, it must have:
# - /usr/bin/lo leading to /opt/Lo/lo, Chromium's sandbox helper setuid root, every library the
#   program needs, where AppArmor runs, Lo's profile loaded, and for an rpm, nothing `rpm -V` finds
#   changed;
# then, started by someone other than root, under Xvfb:
# - quit at once, saying why, when started with anything but a link (--no-sandbox and
#   --disable-gpu among them, and a switch after whitespace), or with a variable set that would
#   write out or expose its traffic, such as SSLKEYLOGFILE;
# - draw its window, with its pages in Chromium's sandbox, open its database, and never read the
#   test servers' manifest LO_TEST_SERVERS names, nor ask the update feed LO_UPDATES_FEED names
#   for anything;
# - take a link from the lo command, handed over by a second copy that then quits, and leave
#   lo.desktop the handler of lo:// links and not of web links;
# and installed again, keep all that, and removed, leave nothing behind; and where /usr/bin/lo is
# someone else's, leave it as it is, installed and removed.
#
# Usage: sh scripts/check-linux.sh <deb or rpm>
# It runs itself with --install where the package installs, and that with --start under Xvfb.
set -euf

# The Fedora that installs an rpm: the latest release, pinned by digest.
FEDORA=fedora:45@sha256:a7d72ba2745b100a3351087472e5ee7b2450af7cf331e7673007e3817612839c
MAINTAINER='Mike Scornavacca <52425912+scornz@users.noreply.github.com>'
HOMEPAGE=https://github.com/withlo/lo
# Where Lo's packages put it, and what they link to it.
PROGRAM=/opt/Lo/lo
COMMAND=/usr/bin/lo
SANDBOX=/opt/Lo/chrome-sandbox
PROFILE=/etc/apparmor.d/lo
# Xvfb's screen. By default Xvfb resets when its last client leaves, and a copy of Lo starting just
# then finds no display.
SCREEN='-screen 0 1280x800x24 -noreset'

# This script, wherever it's run from: in a container, its folder alone is there.
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
self=$here/check-linux.sh
status=0
said=
fail() {
  echo "$said: $1" >&2
  status=1
}

# Runs "$@" as root: as it is when this is root, through sudo when not.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

# Whether AppArmor runs here and installs profiles, as the package's scripts decide it.
apparmor() {
  command -v apparmor_status > /dev/null 2>&1 && as_root apparmor_status --enabled > /dev/null 2>&1
}

# The checks of Lo as installed, which don't start it: the command's link, the sandbox helper's
# mode, AppArmor's profile and the program's libraries.
installed() {
  [ "$(readlink -f "$COMMAND" 2> /dev/null)" = "$PROGRAM" ] ||
    fail "$COMMAND doesn't lead to $PROGRAM: $(ls -l "$COMMAND" 2>&1)"
  mode=$(stat -c '%a %U:%G' "$SANDBOX" 2>&1) || true
  [ "$mode" = '4755 root:root' ] || fail "$SANDBOX isn't setuid root with mode 4755: $mode"
  if apparmor; then
    cmp -s "$PROFILE" /opt/Lo/resources/apparmor-profile ||
      fail "AppArmor runs, and $PROFILE isn't Lo's profile"
    as_root cat /sys/kernel/security/apparmor/profiles | grep -qxF 'lo (unconfined)' ||
      fail "AppArmor runs, and Lo's profile isn't loaded"
    restricted=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2> /dev/null) ||
      restricted=
    if [ "$restricted" = 1 ]; then
      echo "AppArmor runs, and stops unprivileged user namespaces but for profiles such as Lo's."
    else
      echo "AppArmor runs, and lets any program make user namespaces. Lo's profile is loaded."
    fi
  else
    echo "AppArmor doesn't run here, so Lo has no profile."
  fi
  missing=$(ldd "$PROGRAM" | grep 'not found' || true)
  [ -z "$missing" ] || fail "$PROGRAM needs libraries the package's dependencies didn't bring: $missing"
  if [ "$format" = rpm ]; then
    changed=$(rpm -V lo 2>&1) || fail "rpm -V finds Lo's files changed since they were installed: $changed"
  fi
}

# Installs the package (with --reinstall, installs it again), and removes it.
put() {
  if [ "$format" = deb ]; then
    as_root apt-get install -y -q "$@" "$file"
  elif [ "${1-}" = --reinstall ]; then
    dnf reinstall -y -q "$file"
  else
    dnf install -y -q "$file"
  fi
}
drop() {
  if [ "$format" = deb ]; then
    as_root apt-get remove -y -q lo
  else
    dnf remove -y -q lo
  fi
}

if [ "${1-}" = --start ]; then
  # Lo, started by someone other than root under Xvfb, as a person would start it: from the lo
  # command, with a home of its own. It has no session bus, so libdbus doesn't start one.
  said="Lo installed from the $2"
  work=$(mktemp -d)
  listener=
  lo=
  trap '
    [ -z "$lo" ] || kill "$lo" 2> /dev/null || true
    [ -z "$listener" ] || kill "$listener" 2> /dev/null || true
    rm -rf "$work"
  ' EXIT
  mkdir "$work/home"
  # Xvfb's display, with the cookie xvfb-run made for it.
  run() {
    env -i HOME="$work/home" PATH=/usr/bin:/bin DISPLAY="$DISPLAY" XAUTHORITY="${XAUTHORITY-}" \
      DBUS_SESSION_BUS_ADDRESS=disabled: "$@"
  }
  limit=120

  # Runs "$@", Lo as some launch would start it, and succeeds when it ends with status $1 within
  # $limit seconds, having said $2, if anything. One that kept it running would have opened a port,
  # a window or a connection.
  ends() {
    code_wanted=$1
    wanted=$2
    shift 2
    log=$work/ended.log
    run "$@" > "$log" 2>&1 &
    pid=$!
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
    [ "$code" -eq "$code_wanted" ] && { [ -z "$wanted" ] || grep -q -- "$wanted" "$log"; }
  }

  # A packaged Lo takes no command-line arguments but links, so each of these must end it with
  # its reason: the switches people reach for on Linux, switches that would expose its traffic,
  # those Chromium still reads after the whitespace it trims among them, and a file.
  tab=$(printf '\t')
  for switch in --no-sandbox --disable-gpu --remote-debugging-port=0 -remote-debugging-pipe \
    --ignore-certificate-errors '--host-resolver-rules=MAP api.github.com 127.0.0.1:9' \
    " --ssl-key-log-file=$work/keys.log" "$tab--log-net-log=$work/net.json" "$work/x.txt"; do
    ends 1 'Lo takes no command-line arguments but links' "$COMMAND" "$switch" ||
      fail "started with \"$switch\", Lo ended with status $code instead of refusing it: $(cat "$log")"
  done
  # Nor the variables that do what some switches do.
  for variable in "SSLKEYLOGFILE=$work/keys.log" ELECTRON_ENABLE_LOGGING=1 \
    "ELECTRON_LOG_FILE=$work/chromium.log" NODE_TLS_REJECT_UNAUTHORIZED=0; do
    ends 1 "Lo won't start with" env "$variable" "$COMMAND" ||
      fail "started with $variable, Lo ended with status $code instead of refusing it: $(cat "$log")"
  done
  [ ! -e "$work/keys.log" ] || fail "started with SSLKEYLOGFILE or --ssl-key-log-file, Lo wrote to it"
  [ ! -e "$work/net.json" ] || fail "started with --log-net-log, Lo wrote to it"

  # Started with neither, Lo draws its window and doesn't read a manifest of test servers or ask
  # an update feed other than GitHub's. LO_TEST_SERVERS names a pipe, which a writer waits to open
  # until something opens it to read, and LO_UPDATES_FEED a feed on a port of 127.0.0.1 where a
  # listener notes every connection. Lo runs until its window is on screen, which it shows once
  # its page has loaded, and 10 seconds more: a build run from source would have read the manifest
  # as its features started, and asked the feed a second after its window came up.
  python3 -I -c '
import socket, sys
server = socket.socket()
server.bind(("127.0.0.1", 0))
server.listen()
with open(sys.argv[1], "w") as port:
    port.write(str(server.getsockname()[1]))
while True:
    connection, _ = server.accept()
    with open(sys.argv[2], "a") as connections:
        connections.write("connection\n")
    connection.close()
' "$work/feed.port" "$work/feed.connections" &
  listener=$!
  i=0
  while [ ! -s "$work/feed.port" ] && [ "$i" -lt 100 ]; do
    sleep 0.1
    i=$((i + 1))
  done
  port=$(cat "$work/feed.port")
  manifest=$work/servers.json
  mkfifo "$manifest"
  run env LO_TEST_SERVERS="$manifest" LO_UPDATES_FEED="http://127.0.0.1:$port/" "$COMMAND" \
    > "$work/started.log" 2>&1 &
  lo=$!
  (printf '{ "servers": [] }\n' > "$manifest" && touch "$work/servers.read") &
  writer=$!
  # Lo's window: a top-level window of its class, which X maps once Lo shows it.
  shown() {
    windows=$(xwininfo -root -children | sed -n 's/^ *\(0x[0-9a-f]*\) .*("[Ll]o" "[Ll]o").*/\1/p')
    for window in $windows; do
      xwininfo -id "$window" | grep -q 'Map State: IsViewable' && return 0
    done
    return 1
  }
  up=
  waited=0
  while [ "$waited" -lt "$limit" ] && kill -0 "$lo" 2> /dev/null; do
    if shown; then
      up=true
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if [ -n "$up" ]; then
    sleep 10
    # Each of Lo's pages runs in Chromium's sandbox: in a PID namespace of its own, under a seccomp
    # filter, whether Chromium made it in user namespaces or through the setuid helper. Lo is the
    # only program of this user's that has pages.
    processes=$(ps -ww -u "$(id -u)" -o pid=,args=)
    pages=$(printf '%s\n' "$processes" | awk '/ --type=renderer/ { print $1 }')
    [ -n "$pages" ] || fail "Lo runs no page: $processes"
    for page in $pages; do
      seccomp=$(awk '$1 == "Seccomp:" { print $2 }' "/proc/$page/status") || seccomp=
      depth=$(awk '$1 == "NSpid:" { print NF - 1 }' "/proc/$page/status") || depth=
      [ "$seccomp" = 2 ] || fail "Lo's page $page runs under no seccomp filter (Seccomp: $seccomp)"
      [ "${depth:-1}" -ge 2 ] || fail "Lo's page $page runs in the PID namespace Lo started in"
    done
    ! printf '%s\n' "$processes" | grep -q -- --no-sandbox ||
      fail "a process of Lo's runs with --no-sandbox: $processes"
    if pgrep -f "^$SANDBOX " > /dev/null; then
      echo "Chromium sandboxes Lo's pages through its setuid helper."
    else
      echo "Chromium sandboxes Lo's pages in user namespaces."
    fi

    # A link from the lo command reaches the Lo running: a second copy hands it over and quits.
    # A lo:// link that isn't a pull request's opens nothing, so nothing goes to GitHub.
    ends 0 '' "$COMMAND" lo://github.com/withlo/lo ||
      fail "given a link while Lo ran, the lo command ended with status $code: $(cat "$log")"
    kill -0 "$lo" 2> /dev/null || fail "Lo quit when the lo command handed it a link"
  fi
  if kill -0 "$lo" 2> /dev/null; then
    kill "$lo" && wait "$lo" || true
  else
    fail "started with LO_TEST_SERVERS and LO_UPDATES_FEED, Lo ended before its window came up: $(cat "$work/started.log")"
  fi
  lo=
  { kill "$writer" && wait "$writer"; } 2> /dev/null || true
  { kill "$listener" && wait "$listener"; } 2> /dev/null || true
  listener=
  [ -n "$up" ] ||
    fail "Lo's window wasn't on screen within $limit seconds: $(xwininfo -root -tree 2>&1 | grep -i lo)"
  [ -e "$work/home/.config/Lo/lo.db" ] || fail "Lo didn't open its database"
  ! grep -q "couldn't load its window" "$work/started.log" ||
    fail "$(grep "couldn't load its window" "$work/started.log")"
  [ ! -e "$work/servers.read" ] || fail "started with LO_TEST_SERVERS, Lo read the manifest it names"
  [ ! -s "$work/feed.connections" ] || fail "started with LO_UPDATES_FEED, Lo asked the feed it names"

  # Lo's desktop file is what opens lo:// links, including once Lo has made itself their handler,
  # which it does as it starts, by that file's name. Web links stay the browser's.
  handler=$(run xdg-mime query default x-scheme-handler/lo) || handler=
  [ "$handler" = lo.desktop ] || fail "lo:// links open with \"$handler\", not lo.desktop"
  web=$(run xdg-mime query default x-scheme-handler/https) || web=
  [ "$web" != lo.desktop ] || fail "web links open with Lo"
  exit "$status"
fi

if [ "${1-}" = --install ]; then
  # Installs the package here, as root, checks Lo as installed and started, then installs it
  # again, and removes it.
  file=$2
  format=${file##*.}
  said="$(basename -- "$file") installed"
  if [ "$format" = deb ]; then
    as_root apt-get install -y -q "$file"
  else
    # Lo's package, and what this script needs to check it.
    dnf install -y -q --setopt=install_weak_deps=False "$file" xorg-x11-server-Xvfb \
      xorg-x11-xauth xwininfo python3 procps-ng util-linux shadow-utils
  fi
  installed
  # Started by someone other than root, as Chromium's sandbox needs: this user, or a new one.
  if [ "$(id -u)" -eq 0 ]; then
    id lo-check > /dev/null 2>&1 || useradd --create-home lo-check
    runuser -u lo-check -- xvfb-run -a -s "$SCREEN" sh "$self" --start "$format" || status=1
  else
    xvfb-run -a -s "$SCREEN" sh "$self" --start "$format" || status=1
  fi

  # Installed again, as an upgrade installs it, the old package's removal script leaves alone
  # what the new one's install script made.
  said="$(basename -- "$file") installed again"
  put --reinstall
  installed

  said="$(basename -- "$file") removed"
  drop
  [ ! -e "$COMMAND" ] && [ ! -L "$COMMAND" ] || fail "$COMMAND is still there"
  [ ! -e /opt/Lo ] || fail "/opt/Lo is still there: $(ls -A /opt/Lo)"
  [ ! -e "$PROFILE" ] || fail "$PROFILE is still there"
  if apparmor; then
    ! as_root cat /sys/kernel/security/apparmor/profiles | grep -qxF 'lo (unconfined)' ||
      fail "Lo's AppArmor profile is still loaded"
  fi

  # Someone else's lo, there before Lo, which Lo's install leaves as it is, and so does its removal.
  said="$(basename -- "$file") installed where $COMMAND is someone else's"
  as_root ln -s /usr/bin/env "$COMMAND"
  put
  [ "$(readlink "$COMMAND")" = /usr/bin/env ] || fail "it replaced $COMMAND: $(ls -l "$COMMAND" 2>&1)"
  said="$(basename -- "$file") removed where $COMMAND is someone else's"
  drop
  [ "$(readlink "$COMMAND")" = /usr/bin/env ] || fail "it removed $COMMAND: $(ls -l "$COMMAND" 2>&1)"
  as_root rm -f "$COMMAND"
  exit "$status"
fi

if [ $# -ne 1 ]; then
  echo 'usage: check-linux.sh <deb or rpm>' >&2
  exit 2
fi
file=$(CDPATH='' cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
name=$(basename -- "$file")
said=$file

# What the file must hold, from its name, and that this machine can start it.
case $name in
  Lo-?*-amd64.deb | Lo-?*-x86_64.rpm) machine=x86_64 ;;
  Lo-?*-arm64.deb | Lo-?*-aarch64.rpm) machine=aarch64 ;;
  *)
    echo "$file: a Linux package of Lo is named Lo-<version>-<amd64|arm64>.deb or Lo-<version>-<x86_64|aarch64>.rpm" >&2
    exit 2
    ;;
esac
format=${name##*.}
rest=${name%.*}
arch=${rest##*-}
rest=${rest%-*}
version=${rest#Lo-}
if [ "$(uname -m)" != "$machine" ]; then
  echo "$file: it's for $machine, so it's checked on $machine, not $(uname -m)" >&2
  exit 2
fi
# deb and rpm both order a ~ before anything, so a prerelease comes before its release.
packaged=$(printf '%s' "$version" | tr - '~')

cd "$here/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
contents=$work/contents
mkdir "$contents"

# The package's own fields, and its scripts.
if [ "$format" = deb ]; then
  fields=$(dpkg-deb -f "$file" Package Version Architecture License Maintainer Homepage | sort)
  expected=$(printf '%s\n' 'Package: lo' "Version: $packaged" "Architecture: $arch" \
    'License: GPL-3.0-only' "Maintainer: $MAINTAINER" "Homepage: $HOMEPAGE" | sort)
  [ "$fields" = "$expected" ] || fail "the package's fields aren't Lo's: $fields"
  depends=$(dpkg-deb -f "$file" Depends)
  dpkg-deb -e "$file" "$work/control"
  cmp -s "$work/control/postinst" apps/desktop/build/linux/after-install.sh ||
    fail "its postinst isn't build/linux/after-install.sh"
  cmp -s "$work/control/postrm" apps/desktop/build/linux/after-remove.sh ||
    fail "its postrm isn't build/linux/after-remove.sh"
  for script in preinst prerm; do
    [ ! -e "$work/control/$script" ] || fail "it has a $script, which Lo's packages don't"
  done
  owners=$(dpkg-deb -c "$file" | awk '$2 != "0/0" && $2 != "root/root"')
  [ -z "$owners" ] || fail "it holds files root doesn't own: $owners"
  modes=$(dpkg-deb -c "$file" | awk '{ sub(/^\./, "", $6); print $1, $6 }')
  dpkg-deb -x "$file" "$contents"
else
  fields=$(rpm -qp --qf '%{NAME}\n%{VERSION}\n%{ARCH}\n%{LICENSE}\n%{PACKAGER}\n%{URL}\n' "$file")
  expected=$(printf '%s\n' lo "$packaged" "$arch" GPL-3.0-only "$MAINTAINER" "$HOMEPAGE")
  [ "$fields" = "$expected" ] || fail "the package's fields aren't Lo's: $fields"
  depends=$(rpm -qpR "$file")
  [ "$(rpm -qp --qf '%{POSTIN}' "$file")" = "$(cat apps/desktop/build/linux/after-install.sh)" ] ||
    fail "its %post isn't build/linux/after-install.sh"
  [ "$(rpm -qp --qf '%{POSTUN}' "$file")" = "$(cat apps/desktop/build/linux/after-remove.sh)" ] ||
    fail "its %postun isn't build/linux/after-remove.sh"
  for script in PREIN PREUN PRETRANS POSTTRANS; do
    [ "$(rpm -qp --qf "%{$script}" "$file")" = '(none)' ] ||
      fail "it has a $script script, which Lo's packages don't"
  done
  owners=$(rpm -qp --qf '[%{FILEUSERNAME}:%{FILEGROUPNAME} %{FILENAMES}\n]' "$file" | grep -v '^root:root ' || true)
  [ -z "$owners" ] || fail "it holds files root doesn't own: $owners"
  modes=$(rpm -qp --qf '[%{FILEMODES:perms} %{FILENAMES}\n]' "$file")
  rpm2cpio "$file" | (cd "$contents" && cpio -idm --quiet)
fi
# The sandbox helper is setuid root in the package itself, so `rpm -V` finds it as it should be, and
# nothing that sets files back to the package's modes, such as `rpm --setperms`, takes the bit
# away. Nothing else is setuid or setgid.
mode=$(printf '%s\n' "$modes" | awk -v path="$SANDBOX" '$2 == path { print $1 }')
[ "$mode" = -rwsr-xr-x ] || fail "its $SANDBOX is \"$mode\", not setuid -rwsr-xr-x"
setuid=$(printf '%s\n' "$modes" | awk -v path="$SANDBOX" '$2 != path && $1 ~ /[sS]/')
[ -z "$setuid" ] || fail "it holds setuid or setgid files besides $SANDBOX: $setuid"
case $depends in
  *libsecret*) ;;
  *) fail "it doesn't depend on libsecret, which Lo keeps its tokens through: $depends" ;;
esac

# Only Lo in /opt/Lo, its desktop file, its icons, and the deb's changelog.
extra=$(cd "$contents" && find . ! -type d | sed 's|^\.||' | grep -vE \
  '^(/opt/Lo/.+|/usr/share/applications/lo\.desktop|/usr/share/icons/hicolor/[0-9]+x[0-9]+/apps/lo\.png|/usr/share/doc/lo/changelog\.gz)$' ||
  true)
[ -z "$extra" ] || fail "it holds more than Lo, its desktop file and icons: $(echo "$extra" | head -5)"
for entry in "$PROGRAM" "$SANDBOX" /opt/Lo/resources/app.asar /opt/Lo/resources/licenses.txt \
  /opt/Lo/LICENSE.electron.txt /opt/Lo/LICENSES.chromium.html \
  /usr/share/icons/hicolor/512x512/apps/lo.png; do
  [ -f "$contents$entry" ] || fail "it lacks $entry"
done
[ -x "$contents$PROGRAM" ] || fail "$PROGRAM isn't a program"
[ ! -e "$contents/opt/Lo/resources/app.asar.unpacked" ] ||
  fail "it holds files outside the asar: /opt/Lo/resources/app.asar.unpacked"

# The desktop file opens Lo as /opt/Lo/lo with the links it's given, and takes only lo:// links.
# Its comment is the package's description.
desktop=$contents/usr/share/applications/lo.desktop
expected=$(printf '%s\n' '[Desktop Entry]' 'Name=Lo' 'Exec=/opt/Lo/lo %U' 'Terminal=false' \
  'Type=Application' 'Icon=lo' 'StartupWMClass=lo' 'MimeType=x-scheme-handler/lo;' \
  'Categories=Development;' | sort)
found=$(grep -v '^Comment=' "$desktop" | grep -v '^$' | sort)
[ "$found" = "$expected" ] || fail "the desktop file isn't Lo's: $(cat "$desktop")"

# electron-updater reads where updates come from in app-update.yml: anything else there could send
# it elsewhere. package-type tells it which package this is.
resources=$contents/opt/Lo/resources
expected=$(printf '%s\n' 'owner: withlo' 'provider: github' 'repo: lo' 'updaterCacheDirName: lo-updater')
[ "$(sort "$resources/app-update.yml")" = "$expected" ] ||
  fail "app-update.yml names more than GitHub Releases of withlo/lo: $(cat "$resources/app-update.yml")"
[ "$(cat "$resources/package-type")" = "$format" ] ||
  fail "package-type says \"$(cat "$resources/package-type")\", not $format"
expected='abi <abi/4.0>,
include <tunables/global>

profile "lo" "/opt/Lo/lo" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/lo>
}'
[ "$(cat "$resources/apparmor-profile")" = "$expected" ] ||
  fail "the AppArmor profile allows more than user namespaces for $PROGRAM: $(cat "$resources/apparmor-profile")"

fuses=$(pnpm --silent --filter @lo/desktop exec electron-fuses read --app "$contents$PROGRAM") ||
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

asar=$resources/app.asar
entries=$(pnpm --silent --filter @lo/desktop exec asar list "$asar") || fail "the asar can't be listed"
extra=$(printf '%s\n' "$entries" | grep -vE '^/(dist(/|$)|package\.json$)' || true)
[ -z "$extra" ] || fail "the asar holds more than dist/ and package.json: $(echo "$extra" | head -3)"
for entry in /dist/main/index.js /dist/preload/index.cjs /dist/window/index.html; do
  printf '%s\n' "$entries" | grep -qxF -- "$entry" || fail "the asar lacks $entry"
done
# Electron names Lo's desktop file after package.json's desktopName when Lo registers itself for
# lo:// links: Lo.desktop without it, which no package installs.
manifest=$(pnpm --silent --filter @lo/desktop exec node -e "
const { extractFile } = require('@electron/asar');
const { name, version, desktopName } = JSON.parse(extractFile(process.argv[1], 'package.json'));
console.log([name, version, desktopName].join(' '));
" "$asar") || manifest=
[ "$manifest" = "lo $version lo.desktop" ] ||
  fail "the asar's package.json says \"$manifest\", not \"lo $version lo.desktop\""

# Installed and started: a deb here, an rpm in Fedora, privileged so that Chromium's sandbox
# helper can make namespaces in it as it can on a computer, with room in /dev/shm for Chromium.
if [ "$format" = deb ]; then
  sh "$self" --install "$file" || status=1
else
  docker run --rm --privileged --shm-size=1g -v "$here:/check:ro" -v "$file:/$name:ro" \
    "$FEDORA" sh /check/check-linux.sh --install "/$name" || status=1
fi

if [ "$status" -eq 0 ]; then
  echo "$file passed: lo $packaged for $arch, its fields, scripts, files and desktop file, GitHub's update feed, AppArmor's profile, fuses and asar; installed, its command, setuid sandbox helper and libraries; started, it refuses switches, files and variables, draws its window with its pages sandboxed, reads no test servers or other feed, takes a link from the lo command and opens lo:// links; installed again and removed, it leaves nothing behind, and it leaves someone else's lo command as it is."
fi
exit "$status"
