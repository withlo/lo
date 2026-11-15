#!/usr/bin/env bash
# Puts the code fixtures (`code.sh` and `code-hostile.sh`) in rozed-dev/e2e back as they were made, so
# a run of the live check, or of anything else that pushed to them or wrote on them, can be done
# again:
#
#   LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> bash testing/fixtures/code-reset.sh
#
# As rozed-bot, it makes every commit again, which come out with the IDs they had, and pushes
# `code/base`, `code/feature` and `code/hostile` to rozed-dev/e2e and `code/fork` to rozed-bot's
# fork, replacing whatever those branches hold now. It opens a pull request that was closed, puts
# back each one's title, description and base branch, and gives each the fixture label. Then, on
# each pull request, it deletes rozed-bot's pending review and every review comment and
# conversation comment, since the fixtures hold none. A submitted review can't be deleted: one a
# test submitted with a summary stays, and says so here. It checks the token's account first, and
# writes nowhere but rozed-dev/e2e and the fork. A pull request that was merged can't be opened
# again, and stops it.
#
# It leaves Lo's own state alone: what Lo trusts, the banner's dismissals and its checkouts are in
# Lo's data folder and cache, which a test runs from a folder of its own.

# The variables are set by the functions the other scripts define.
# shellcheck disable=SC2034,SC2154

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=testing/fixtures/code.sh
. "$here/code.sh"
# shellcheck source=testing/fixtures/code-hostile.sh
. "$here/code-hostile.sh"

main() {
  if [ $# -ne 0 ]; then
    echo "usage: LO_FIXTURE_TOKEN_FILE=<file> bash testing/fixtures/code-reset.sh" >&2
    exit 2
  fi
  code_setup
  work=$scratch/work
  code_login code-reset.sh
  build_code
  build_hostile
  publish_code
  publish_hostile
  clean_pull "$code_pull"
  clean_pull "$fork_pull"
  clean_pull "$hostile_pull"
  echo "the code fixtures are as code.sh and code-hostile.sh made them: $E2E_REPO#$code_pull," \
    "#$fork_pull from the fork, and #$hostile_pull"
}

main "$@"
