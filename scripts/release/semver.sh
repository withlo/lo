# shellcheck shell=sh
# The versions Lo is released as, for the release scripts, which source this file: SemVer 2.0.0
# without build metadata, such as 0.1.0 or 0.1.0-rc.1. That's three numbers without leading zeros,
# then dot-separated prerelease identifiers: numbers without leading zeros, or names of letters,
# digits and hyphens. Build metadata is left out because a version comparison ignores it, so it
# couldn't tell one release from another.

# Succeeds when $1 is such a version, on one line.
is_release_version() {
  case $1 in
    *'
'* | *+*) return 1 ;;
  esac
  number='(0|[1-9][0-9]*)'
  identifier="($number|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
  printf '%s\n' "$1" | LC_ALL=C grep -Eqx "$number\\.$number\\.$number(-$identifier(\\.$identifier)*)?"
}
