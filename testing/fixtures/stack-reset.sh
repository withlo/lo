#!/usr/bin/env bash
# Puts the stack fixture (`stack.sh`) in rozed-dev/e2e back as it was made, so what making a GitHub
# stack of its pull requests writes can be recorded again:
#
#   LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> bash testing/fixtures/stack-reset.sh
#
# As rozed-bot, it unstacks any GitHub stack holding #A, #B, #C or #D, then changes back the base
# branch of each one whose base isn't the one it was opened with, as making #A, #B and #C a GitHub
# stack changes #C's to `stack/b`. #G1 and #G2's GitHub stack stays. The token never reaches a
# command's arguments or the output.

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
token_file=${LO_FIXTURE_TOKEN_FILE:?set LO_FIXTURE_TOKEN_FILE to a file holding rozed-bot\'s token}
repo=rozed-dev/e2e
# The pull requests' numbers, as stack.sh has them.
eval "$(grep -E '^STACK_[A-Z0-9]+=[0-9]+$' "$here/stack.sh")"

# Sends <method> to GitHub's API at <path>, with <body> as JSON if given, as rozed-bot, and prints
# what GitHub answers. Fails when GitHub refuses it. curl reads the token from its standard input.
api() {
  local method=$1 path=$2 body=${3-}
  local token
  local data=()
  if [ -n "$body" ]; then data=(--header 'Content-Type: application/json' --data "$body"); fi
  token=$(tr -d '[:space:]' <"$token_file")
  printf 'header = "Authorization: token %s"\n' "$token" |
    curl --silent --show-error --fail-with-body --config - \
      --request "$method" \
      --header 'Accept: application/vnd.github+json' \
      --header 'X-GitHub-Api-Version: 2022-11-28' \
      ${data[@]+"${data[@]}"} \
      "https://api.github.com$path"
}

# Prints <expression>, JavaScript reading `json`, the JSON on standard input.
read_json() {
  node -e "const json = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); console.log($1);"
}

login=$(api GET /user | read_json 'json.login')
if [ "$login" != rozed-bot ]; then
  echo "stack-reset.sh: the token is $login's, not rozed-bot's" >&2
  exit 1
fi

# Each pull request, with the base branch it was opened with.
bases=("$STACK_A stack/root" "$STACK_B stack/a" "$STACK_C stack/root" "$STACK_D stack/a")

for entry in "${bases[@]}"; do
  pr=${entry%% *}
  stacks=$(api GET "/repos/$repo/stacks?pull_request=$pr" |
    read_json 'json.filter((s) => s.open).map((s) => s.number).join(" ")')
  for stack in $stacks; do
    api POST "/repos/$repo/stacks/$stack/unstack" >/dev/null
    echo "unstacked GitHub stack #$stack, which held #$pr"
  done
done

for entry in "${bases[@]}"; do
  pr=${entry%% *}
  base=${entry#* }
  now=$(api GET "/repos/$repo/pulls/$pr" | read_json 'json.base.ref')
  if [ "$now" != "$base" ]; then
    api PATCH "/repos/$repo/pulls/$pr" "{\"base\":\"$base\"}" >/dev/null
    echo "changed #$pr's base branch from $now back to $base"
  fi
done
echo "the stack fixture is as stack.sh made it"
