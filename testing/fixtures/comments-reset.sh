#!/usr/bin/env bash
# Puts the comments fixture (`comments.sh`), #94 and #95 in rozed-dev/e2e, back as it was made, so
# what Lo writes there can be recorded again:
#
#   LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> bash testing/fixtures/comments-reset.sh
#
# As rozed-bot, it deletes rozed-bot's pending review on each pull request, if there is one, and
# every review comment and conversation comment that doesn't start with `Fixture C:`, which the
# fixture's all do. Then it resolves the one thread the fixture resolved and unresolves the rest.
# A submitted review can't be deleted: one a recording submitted stays, and says so here. The
# token never reaches a command's arguments or the output.

# GraphQL's variables, and the JavaScript that reads the answers, are in single quotes so the shell
# leaves their `$` alone.
# shellcheck disable=SC2016

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
token_file=${LO_FIXTURE_TOKEN_FILE:?set LO_FIXTURE_TOKEN_FILE to a file holding rozed-bot\'s token}
owner=rozed-dev
name=e2e
repo=$owner/$name
# The pull requests' numbers, as comments.sh has them.
eval "$(grep -E '^COMMENTS_(RENAME_)?PULL=[0-9]+$' "$here/comments.sh")"
# What every comment the fixture holds starts with.
prefix='Fixture C:'
# The first comment of the one thread the fixture resolved.
resolved=4567381976

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

# Sends a GraphQL <query> with <variables>, as JSON, and prints GitHub's data. Fails on any error.
graphql() {
  local body
  body=$(QUERY=$1 VARIABLES=$2 node -e \
    'console.log(JSON.stringify({ query: process.env.QUERY, variables: JSON.parse(process.env.VARIABLES) }))')
  api POST /graphql "$body" | node -e '
    const json = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (json.errors) { console.error(JSON.stringify(json.errors)); process.exit(1); }
    console.log(JSON.stringify(json.data));'
}

# Prints <expression>, JavaScript reading `json`, the JSON on standard input.
read_json() {
  PREFIX=$prefix node -e "const prefix = process.env.PREFIX; const json = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); console.log($1);"
}

login=$(api GET /user | read_json 'json.login')
if [ "$login" != rozed-bot ]; then
  echo "comments-reset.sh: the token is $login's, not rozed-bot's" >&2
  exit 1
fi

# Puts pull request <pull> back as the fixture made it.
reset() {
  local pull=$1 pending reviews threads wrong comment review each thread mutation
  pending=$(graphql 'query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) { reviews(states: [PENDING], author: "rozed-bot", first: 1) { nodes { databaseId } } }
    }
  }' "{\"owner\":\"$owner\",\"name\":\"$name\",\"number\":$pull}" |
    read_json 'json.repository.pullRequest.reviews.nodes.map((review) => review.databaseId).join(" ")')
  for review in $pending; do
    api DELETE "/repos/$repo/pulls/$pull/reviews/$review" >/dev/null
    echo "#$pull: deleted rozed-bot's pending review"
  done

  others='json.filter((comment) => !comment.body.startsWith(prefix)).map((comment) => comment.id).join(" ")'
  for comment in $(api GET "/repos/$repo/pulls/$pull/comments?per_page=100" | read_json "$others"); do
    api DELETE "/repos/$repo/pulls/comments/$comment" >/dev/null
    echo "#$pull: deleted review comment $comment"
  done
  for comment in $(api GET "/repos/$repo/issues/$pull/comments?per_page=100" | read_json "$others"); do
    api DELETE "/repos/$repo/issues/comments/$comment" >/dev/null
    echo "#$pull: deleted conversation comment $comment"
  done

  reviews=$(api GET "/repos/$repo/pulls/$pull/reviews?per_page=100" |
    read_json 'json.filter((review) => review.state !== "PENDING" && review.body !== "" && !review.body.startsWith(prefix)).length')
  if [ "$reviews" != 0 ]; then
    echo "#$pull: $reviews submitted reviews with a summary were added since, which GitHub can't delete"
  fi

  threads=$(graphql 'query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { databaseId } } } }
      }
    }
  }' "{\"owner\":\"$owner\",\"name\":\"$name\",\"number\":$pull}")
  wrong=$(printf '%s' "$threads" | RESOLVED=$resolved read_json '
    json.repository.pullRequest.reviewThreads.nodes
      .filter((thread) => thread.isResolved !== (thread.comments.nodes[0]?.databaseId === Number(process.env.RESOLVED)))
      .map((thread) => `${thread.id}:${thread.isResolved ? "unresolve" : "resolve"}`)
      .join(" ")')
  for each in $wrong; do
    thread=${each%%:*}
    case ${each#*:} in
      resolve) mutation=resolveReviewThread ;;
      *) mutation=unresolveReviewThread ;;
    esac
    graphql "mutation(\$id: ID!) { $mutation(input: { threadId: \$id }) { thread { id } } }" \
      "{\"id\":\"$thread\"}" >/dev/null
    echo "#$pull: ${each#*:}d thread $thread"
  done
}

for pull in "$COMMENTS_PULL" "$COMMENTS_RENAME_PULL"; do reset "$pull"; done
echo "the comments fixture is as comments.sh made it"
