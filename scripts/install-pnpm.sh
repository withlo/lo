#!/bin/sh
# Installs the pnpm that package.json pins (devEngines.packageManager) into <dir>, for the
# workflows that build what Lo releases or publishes. They don't use pnpm/setup, which restores
# and saves an Actions cache of its own whatever it's told, and nothing here is cached. It
# downloads pnpm's self-contained executable for this machine from npm (@pnpm/exe.<os>-<cpu>), and
# refuses it unless its SHA-512 is the one pnpm-lock.yaml pins for that package, which pnpm writes
# there when the pin moves. pnpm then installs the Node that package.json pins, checked against the
# lockfile too.
# Usage: sh scripts/install-pnpm.sh <dir>
set -euf
if [ $# -ne 1 ]; then
  echo 'usage: install-pnpm.sh <dir>' >&2
  exit 2
fi
dir=$1
cd "$(dirname "$0")/.."
refuse() {
  echo "$1" >&2
  exit 1
}

version=$(jq -r .devEngines.packageManager.version package.json)
printf '%s\n' "$version" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' ||
  refuse "package.json pins pnpm \"$version\", not an exact version."
case $(uname -s) in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) refuse "There's no pnpm here for $(uname -s)." ;;
esac
case $(uname -m) in
  arm64 | aarch64) cpu=arm64 ;;
  x86_64) cpu=x64 ;;
  *) refuse "There's no pnpm here for $(uname -m)." ;;
esac
package=@pnpm/exe.$os-$cpu

# The package's entry in the lockfile's packages, whose next line pins its integrity.
integrity=$(awk -v key="  '$package@$version':" '$0 == key { getline; print; exit }' pnpm-lock.yaml |
  sed -n 's/^    resolution: {integrity: \(sha512-[A-Za-z0-9+/]*=*\)}$/\1/p')
[ -n "$integrity" ] || refuse "pnpm-lock.yaml pins no SHA-512 for $package@$version."

mkdir -p "$dir"
tarball=$dir/pnpm.tgz
curl -sSfL --retry 4 --retry-connrefused --connect-timeout 10 --max-time 300 -o "$tarball" \
  "https://registry.npmjs.org/$package/-/exe.$os-$cpu-$version.tgz"
found=sha512-$(openssl dgst -sha512 -binary "$tarball" | base64 | tr -d '\n')
if [ "$found" != "$integrity" ]; then
  rm -f "$tarball"
  refuse "$package@$version's download is $found, and pnpm-lock.yaml pins $integrity."
fi
tar -xzf "$tarball" -C "$dir" --strip-components 1 package/pnpm
rm "$tarball"
installed=$("$dir/pnpm" --version)
[ "$installed" = "$version" ] || refuse "The pnpm installed says it's $installed, not $version."
echo "Installed pnpm $version, checked against pnpm-lock.yaml, in $dir."
