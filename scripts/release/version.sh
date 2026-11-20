#!/bin/sh
# Checks the tag a release is built from, for the release workflow, and prints its version as
# `version=<version>` and `prerelease=<true|false>` lines for $GITHUB_OUTPUT. The tag must be a v
# and a SemVer version without build metadata, such as v0.1.0 or v0.1.0-rc.1, on the commit checked
# out, which <main> must hold. Run it in the repository, with <main> fetched.
# Usage: sh scripts/release/version.sh <tag's ref, such as refs/tags/v0.1.0> <main, such as origin/main>
set -euf
if [ $# -ne 2 ]; then
  echo 'usage: version.sh <ref> <main>' >&2
  exit 2
fi
ref=$1
main=$2
refuse() {
  echo "$1" >&2
  exit 1
}

case $ref in
  *'
'*) refuse "The ref holds a line break, so it's not a release's tag." ;;
  refs/tags/v*) ;;
  refs/tags/*) refuse "${ref#refs/tags/} isn't a release's tag, which is a v and a version, such as v0.1.0." ;;
  *) refuse "$ref isn't a tag, and a release is built only from one." ;;
esac
tag=${ref#refs/tags/}
version=${tag#v}

# shellcheck source=scripts/release/semver.sh
. "$(dirname -- "$0")/semver.sh"
case $version in
  *+*) refuse "$tag has build metadata, which a version comparison ignores, so it couldn't tell this release from another." ;;
esac
is_release_version "$version" ||
  refuse "$tag isn't a v and a SemVer version, such as v0.1.0 or v0.1.0-rc.1."

commit=$(git rev-parse --verify --quiet "$ref^{commit}") || refuse "There's no tag $tag here."
[ "$commit" = "$(git rev-parse HEAD)" ] || refuse "$tag isn't on the commit checked out."
git rev-parse --verify --quiet "$main^{commit}" > /dev/null || refuse "There's no $main here."
git merge-base --is-ancestor "$commit" "$main" || refuse "$tag is on $commit, which $main doesn't hold."

case $version in
  *-*) prerelease=true ;;
  *) prerelease=false ;;
esac
echo "version=$version"
echo "prerelease=$prerelease"
