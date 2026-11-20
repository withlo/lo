#!/bin/sh
# Runs as root once Lo's deb or rpm has been removed: the deb's postrm, the rpm's %postun. It takes
# away what after-install.sh made outside the package's own files: the lo command's link and Lo's
# AppArmor profile.
#
# On an upgrade or a reinstall it does nothing. An rpm's new %post runs before the old %postun,
# which would otherwise take the link and the profile it had just made, and a deb's new postinst
# runs after it anyway.
#
# build/release.yml hands it to electron-builder, which reads a name in braces after a dollar sign
# as a macro of its own, and fails on one it doesn't know, so nothing here is written so.
set -e

# rpm passes how many copies of Lo stay installed, 0 once it's erased; dpkg what it's doing.
case $1 in
  0 | remove) ;;
  *) exit 0 ;;
esac

if command -v update-alternatives > /dev/null 2>&1; then
  update-alternatives --remove lo /opt/Lo/lo || true
fi
# A link made without update-alternatives, and only one to Lo: a lo of anyone else's stays.
if [ -L /usr/bin/lo ] && [ "$(readlink /usr/bin/lo)" = /opt/Lo/lo ]; then
  rm -f /usr/bin/lo
fi

# Unloaded before it's deleted, so it doesn't stay in force until the next boot.
if [ -f /etc/apparmor.d/lo ]; then
  if command -v apparmor_status > /dev/null 2>&1 && apparmor_status --enabled > /dev/null 2>&1 &&
    ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
    apparmor_parser --remove /etc/apparmor.d/lo || true
  fi
  rm -f /etc/apparmor.d/lo
fi

if command -v update-desktop-database > /dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
