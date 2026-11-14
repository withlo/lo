#!/bin/sh
# The overview checker's package, skill/checker, and its copy on npm. The publish workflow and CI's
# overview job both run this, so the package is always built and packed the same way.
#
#   lookup      Prints, for $GITHUB_OUTPUT, the package's name and version from its package.json,
#               and whether npm has the package (package=) and that version (published=).
#   pack <dir>  Builds the checker and packs it into <dir>, then prints the tarball's path.
#   compare     Passes when npm hasn't got this version. Otherwise packs the checker and fails when
#               the package differs from npm's copy of the version: Lo's skill runs the checker by
#               its version, so any change to the package needs a new one. The manifests are
#               compared without devDependencies, nx and the scripts that only build the package.
#
# Usage: sh scripts/overview-npm.sh lookup | pack <dir> | compare
set -eu
cd "$(dirname "$0")/.."

usage='Usage: sh scripts/overview-npm.sh lookup | pack <dir> | compare'
name=$(jq -r .name skill/checker/package.json)
version=$(jq -r .version skill/checker/package.json)
# The registry takes a scoped name with its slash escaped.
escaped=$(printf '%s' "$name" | sed 's|/|%2F|')

# npm drops a version's build metadata when it publishes, so 1.2.3+build goes out as 1.2.3 and the
# registry answers only to 1.2.3. Lo's skill runs the checker by the version written here, and the
# lookups below ask npm for it as written, so a version with build metadata is refused.
case $version in
  *+*)
    echo "$name's version, $version, has build metadata, which npm drops when it publishes." >&2
    echo "Give skill/checker/package.json a version without it." >&2
    exit 1
    ;;
esac

# curl's options for the registry: a bound on each try, and a few more tries on a timeout, a refused
# connection, a 429 or a 5xx.
fetch() {
  curl -sS --connect-timeout 10 --max-time 60 --retry 4 --retry-connrefused "$@"
}

# Whether the registry has <path>, writing what it answered to <file>: true for 200, false for 404,
# and a failure for anything else, once the tries run out, so an outage never reads as a version
# that's free to publish.
has() {
  status=$(fetch -H 'Accept: application/vnd.npm.install-v1+json' -o "$2" -w '%{http_code}' \
    "https://registry.npmjs.org/$1")
  case $status in
    200) echo true ;;
    404) echo false ;;
    *)
      echo "npm answered $status for $1." >&2
      return 1
      ;;
  esac
}

# Builds the checker and packs it into <dir>, printing the tarball's path. pnpm pack, not npm's,
# since it swaps in what publishConfig sets.
pack() {
  mkdir -p "$1"
  pnpm nx run checker:build --output-style=static >&2
  pnpm --dir skill/checker pack --pack-destination "$1" >&2
  tarball="$1/$(printf '%s' "$name" | sed 's|^@||; s|/|-|')-$version.tgz"
  if [ ! -f "$tarball" ]; then
    echo "pnpm pack didn't make $tarball." >&2
    return 1
  fi
  echo "$tarball"
}

# Unpacks <tarball> into <dir>, leaving out the one folder it holds (usually package/), with its
# manifest cut to what the package is: without devDependencies, nx and the scripts that only build
# it, so bumping a build tool alone needs no new version. The scripts an install runs (preinstall,
# install, postinstall and prepare) stay. Every other file stays as it is.
unpack() {
  mkdir -p "$2"
  tar -xzf "$1" -C "$2" --strip-components=1
  jq -S 'del(.devDependencies, .nx) | .scripts //= {}
    | .scripts |= with_entries(select(.key | test("^((pre|post)?install|prepare)$")))
    | if .scripts == {} then del(.scripts) else . end' "$2/package.json" > "$work/manifest.json"
  mv "$work/manifest.json" "$2/package.json"
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

case ${1:-} in
  lookup)
    package=$(has "$escaped" "$work/package.json")
    published=false
    if [ "$package" = true ]; then published=$(has "$escaped/$version" "$work/version.json"); fi
    echo "name=$name"
    echo "version=$version"
    echo "package=$package"
    echo "published=$published"
    ;;
  pack)
    if [ -z "${2:-}" ]; then
      echo "$usage" >&2
      exit 2
    fi
    pack "$2"
    ;;
  compare)
    published=$(has "$escaped/$version" "$work/version.json")
    if [ "$published" = false ]; then
      echo "npm hasn't got $name@$version, so the version is new."
      exit 0
    fi
    fetch -f -o "$work/npm.tgz" "$(jq -r .dist.tarball "$work/version.json")"
    ours=$(pack "$work/ours")
    unpack "$work/npm.tgz" "$work/npm"
    unpack "$ours" "$work/ours/unpacked"
    if ! diff -rq "$work/npm" "$work/ours/unpacked"; then
      echo "skill/checker packs differently from $name@$version on npm. Give it a new version in" >&2
      echo "skill/checker/package.json; merging that publishes it." >&2
      exit 1
    fi
    echo "skill/checker packs the same as $name@$version on npm."
    ;;
  *)
    echo "$usage" >&2
    exit 2
    ;;
esac
