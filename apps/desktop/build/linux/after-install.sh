#!/bin/sh
# Runs as root once Lo's deb or rpm has put Lo in /opt/Lo: the deb's postinst, the rpm's %post, on
# an install, a reinstall and an upgrade alike. It links the lo command to Lo's program, keeps
# Chromium's sandbox helper setuid root, gives Lo the AppArmor profile that lets it make user
# namespaces on Ubuntu 24.04 and later, and has the desktop read Lo's desktop file.
#
# build/release.yml hands it to electron-builder, which reads a name in braces after a dollar sign
# as a macro of its own, and fails on one it doesn't know, so nothing here is written so.
set -e

# The lo command: /usr/bin/lo, a link to Lo's program, through update-alternatives where the
# system has it, as Debian, Ubuntu and Fedora do. It's made only where it's Lo's to make: where
# there's none, or a link that leads nowhere, into /opt/Lo, or to the lo alternative. A lo of
# anyone else's stays as it is, and Lo's Settings show Lo's own lo command as not installed.
ours=
if [ ! -L /usr/bin/lo ]; then
  [ -e /usr/bin/lo ] || ours=true
elif [ ! -e /usr/bin/lo ]; then
  ours=true
else
  case $(readlink /usr/bin/lo) in
    /opt/Lo/* | /etc/alternatives/lo) ours=true ;;
    *) ;;
  esac
fi
if [ -z "$ours" ]; then
  echo "/usr/bin/lo isn't Lo's, so Lo left it as it is." >&2
elif command -v update-alternatives > /dev/null 2>&1; then
  # A link Lo made itself, not through update-alternatives, or one that leads nowhere, gives way.
  if [ -L /usr/bin/lo ] && [ "$(readlink /usr/bin/lo)" != /etc/alternatives/lo ]; then
    rm -f /usr/bin/lo
  fi
  update-alternatives --install /usr/bin/lo lo /opt/Lo/lo 100 || ln -sf /opt/Lo/lo /usr/bin/lo
else
  ln -sf /opt/Lo/lo /usr/bin/lo
fi

# Chromium's sandbox helper, setuid root, as Chrome's own packages ship it. Chromium sandboxes Lo's
# window in user namespaces where it can make them, and through this helper where it can't: where
# they're turned off, or where AppArmor stops them. A packaged Lo refuses --no-sandbox, so with
# neither it wouldn't start at all. Checked as root, as electron-builder's own script checks, user
# namespaces always seem to work, so this doesn't depend on them. The package itself holds it so;
# this sets it again in case something on the way didn't keep the bit.
chown root:root /opt/Lo/chrome-sandbox
chmod 4755 /opt/Lo/chrome-sandbox

# Ubuntu 24.04 and later stop a program making user namespaces unless an AppArmor profile allows
# it. Lo's, which electron-builder writes into Lo's resources, leaves Lo unconfined and allows
# them. It goes in only where AppArmor runs and takes the profile's ABI (Ubuntu 22.04's doesn't,
# and lets Lo make them without one), and it's loaded at once, except in a chroot, where the next
# boot loads it.
if command -v apparmor_status > /dev/null 2>&1 && apparmor_status --enabled > /dev/null 2>&1; then
  profile=/opt/Lo/resources/apparmor-profile
  if apparmor_parser --skip-kernel-load --debug "$profile" > /dev/null 2>&1; then
    cp -f "$profile" /etc/apparmor.d/lo
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
      apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/lo ||
        echo "Lo's AppArmor profile didn't load, so Lo uses Chromium's sandbox helper." >&2
    fi
  else
    echo "This AppArmor doesn't take Lo's profile, so Lo goes without it." >&2
  fi
fi

# The desktop reads the desktop file anew, which registers Lo for lo:// links.
if command -v update-desktop-database > /dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
