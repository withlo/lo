# shellcheck shell=bash
# What the code features' fixture scripts share: `code.sh`, `code-hostile.sh` and `code-reset.sh`
# source it. It has git's environment for building commits that come out the same on any machine,
# the helpers that write files and commits, and what talks to GitHub as rozed-bot: its API, a push,
# and opening a pull request.
#
# Everything that writes to GitHub goes to rozed-dev/e2e, or to rozed-bot's fork of it, and only
# once GET /user has said the token is rozed-bot's. The token is read from the file
# `LO_FIXTURE_TOKEN_FILE` names each time it's needed, and reaches no command's arguments or output.
# It's kept in a file, never in a variable, and curl and git are handed it by a pipe and a
# credential helper.

# `work`, `scratch` and `pull` are set by the scripts that source this; the JavaScript and the
# credential helper are in single quotes so the shell leaves their `$` alone.
# shellcheck disable=SC2016,SC2154

# The test repository the pull requests are in, and rozed-bot's fork of it, which holds the branch
# the pull request from a fork comes from.
E2E_REPO=rozed-dev/e2e
FORK_REPO=rozed-bot/e2e
# The label every fixture pull request has.
LABEL=fixture

# Sets up what a script needs: a scratch folder that's removed when it ends, and git's environment.
# Sets `scratch`.
code_setup() {
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' EXIT
  mkdir -p "$scratch/home"
  # None of the user's or the system's settings, so nothing signs or rewrites a commit.
  export HOME=$scratch/home GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 LC_ALL=C
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
  export GIT_AUTHOR_NAME=rozed-bot GIT_AUTHOR_EMAIL=353226052+rozed-bot@users.noreply.github.com
  export GIT_COMMITTER_NAME=rozed-bot GIT_COMMITTER_EMAIL=353226052+rozed-bot@users.noreply.github.com
  export GIT_TERMINAL_PROMPT=0
  umask 022
}

# Fails, saying why, when <folder>, which `--local` builds in, is inside a git work tree: the tools
# run there, git and Nx among them, would take what's built for the repository's own, and load what
# the hostile fixture plants. git is asked in the nearest folder that exists, and each folder above
# <folder> is looked at for a `.git`, so one that doesn't exist yet is covered. Run before anything
# is made there.
check_local_folder() {
  local script=$1 folder=$2 dir top
  case $folder in
    /*) ;;
    *) folder=$PWD/$folder ;;
  esac
  dir=$folder
  while [ ! -d "$dir" ]; do dir=$(dirname "$dir"); done
  top=$(
    unset GIT_DIR GIT_WORK_TREE GIT_CEILING_DIRECTORIES
    if [ "$(git -C "$dir" rev-parse --is-inside-work-tree 2>/dev/null)" = true ]; then
      git -C "$dir" rev-parse --show-toplevel
    fi
  )
  dir=$folder
  while [ -z "$top" ]; do
    if [ -e "$dir/.git" ]; then top=$dir; fi
    if [ "$dir" = / ]; then break; fi
    dir=$(dirname "$dir")
  done
  if [ -n "$top" ]; then
    echo "$script: $2 is inside the git work tree $top, whose tools would load what's built there." >&2
    echo "$script: build it in a folder of its own, outside every repository, such as \"\$(mktemp -d)\"." >&2
    return 1
  fi
}

# Runs git in the working copy, `work`. Nothing here runs git anywhere else but in the folder
# `--local` builds in and those above it, before anything is built, so a repository planted in a
# folder of the working copy is never opened.
g() { git -C "$work" -c core.autocrlf=false -c core.fileMode=true -c commit.gpgSign=false "$@"; }

# Writes stdin to <path> in the working copy, making its folder.
put() {
  mkdir -p "$(dirname "$work/$1")"
  cat >"$work/$1"
}

# Writes stdin to <path> in the working copy, as a program a tool may run.
put_exec() {
  put "$1"
  chmod +x "$work/$1"
}

# Commits what's staged as written and committed at <date>.
commit_staged() {
  GIT_AUTHOR_DATE=$2 GIT_COMMITTER_DATE=$2 g commit -q -m "$1"
}

# Commits everything in the working copy as written and committed at <date>.
commit() {
  g add -A
  commit_staged "$@"
}

# Makes <bare>, a bare repository holding the branches <refspec>... of the working copy, as GitHub
# holds them. It lets clients filter and fetch any commit by ID, as GitHub does, so Lo can fetch
# from it with `LO_GIT_REMOTE=file://<folder>`.
make_bare() {
  local bare=$1
  shift
  rm -rf "$bare"
  mkdir -p "$(dirname "$bare")"
  git init -q --bare "$bare"
  git -C "$bare" config uploadpack.allowFilter true
  git -C "$bare" config uploadpack.allowAnySHA1InWant true
  git -C "$bare" config gc.auto 0
  g push -q "$bare" "$@"
}

# --- GitHub, as rozed-bot ---------------------------------------------------------------------

# Fails unless LO_FIXTURE_TOKEN_FILE names a file holding rozed-bot's token. Run before anything
# else here.
code_login() {
  local script=$1 login
  if [ -z "${LO_FIXTURE_TOKEN_FILE-}" ]; then
    echo "$script: set LO_FIXTURE_TOKEN_FILE to a file holding rozed-bot's token" >&2
    return 1
  fi
  if [ ! -f "$LO_FIXTURE_TOKEN_FILE" ]; then
    echo "$script: $LO_FIXTURE_TOKEN_FILE isn't a file" >&2
    return 1
  fi
  # An absolute path, since git runs the credential helper from the working copy.
  LO_FIXTURE_TOKEN_FILE=$(cd "$(dirname "$LO_FIXTURE_TOKEN_FILE")" && pwd)/$(basename "$LO_FIXTURE_TOKEN_FILE")
  export LO_FIXTURE_TOKEN_FILE
  login=$(api GET /user | read_json 'json.login')
  if [ "$login" != rozed-bot ]; then
    echo "$script: the token is $login's, not rozed-bot's" >&2
    return 1
  fi
}

# Sends <method> to GitHub's API at <route>, with <body> as JSON if given, as rozed-bot, and prints
# what GitHub answers. Fails when GitHub refuses it. curl reads the token from its standard input.
api() {
  local method=$1 route=$2 body=${3-}
  local token
  local data=()
  if [ -n "$body" ]; then data=(--header 'Content-Type: application/json' --data "$body"); fi
  token=$(tr -d '[:space:]' <"$LO_FIXTURE_TOKEN_FILE")
  printf 'header = "Authorization: token %s"\n' "$token" |
    curl --silent --show-error --fail-with-body --config - \
      --request "$method" \
      --header 'Accept: application/vnd.github+json' \
      --header 'X-GitHub-Api-Version: 2022-11-28' \
      ${data[@]+"${data[@]}"} \
      "https://api.github.com$route"
}

# Prints <expression>, JavaScript reading `json`, the JSON on standard input.
read_json() {
  node -e "const json = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); console.log($1);"
}

# Prints a JSON object of strings from <key>=<value>... arguments.
json_of() {
  node -e '
    const object = {};
    for (const pair of process.argv.slice(1)) {
      const at = pair.indexOf("=");
      object[pair.slice(0, at)] = pair.slice(at + 1);
    }
    console.log(JSON.stringify(object));' "$@"
}

# Pushes <refspec>... from the working copy to <repo>, replacing what's there: the fixtures'
# branches are made again from the same commits, so a push that changes anything puts back what was
# changed. Only the two repositories the fixtures live in take a push, and git is given the token
# by a credential helper that reads the file, so it's in no argument or variable.
push_to() {
  local repo=$1
  shift
  local helper
  case $repo in
    "$E2E_REPO" | "$FORK_REPO") ;;
    *)
      echo "code fixtures: refusing to push to $repo" >&2
      return 1
      ;;
  esac
  helper='!f() { test "$1" = get || exit 0; echo username=rozed-bot; printf "password=%s\n" "$(tr -d "[:space:]" <"$LO_FIXTURE_TOKEN_FILE")"; }; f'
  g -c credential.helper= -c "credential.helper=$helper" push --force --quiet \
    "https://github.com/$repo.git" "$@"
}

# Makes sure rozed-bot has a fork of rozed-dev/e2e, which the pull request from a fork comes from.
ensure_fork() {
  local waited=0 info
  if ! info=$(api GET "/repos/$FORK_REPO" 2>/dev/null); then
    echo "forking $E2E_REPO"
    api POST "/repos/$E2E_REPO/forks" '{"default_branch_only":true}' >/dev/null
    until info=$(api GET "/repos/$FORK_REPO" 2>/dev/null); do
      waited=$((waited + 2))
      if [ "$waited" -gt 60 ]; then
        echo "code fixtures: GitHub didn't make the fork $FORK_REPO in a minute" >&2
        return 1
      fi
      sleep 2
    done
  fi
  if [ "$(printf '%s' "$info" | read_json 'json.fork && json.parent.full_name')" != "$E2E_REPO" ]; then
    echo "code fixtures: $FORK_REPO isn't a fork of $E2E_REPO" >&2
    return 1
  fi
}

# Prints the number and state (`open`, `closed` or `merged`) of the pull request from <head> in
# rozed-dev/e2e, preferring an open one to the newest, and nothing when there's none. <head> is a
# branch of rozed-dev/e2e or <owner>:<branch>. It looks by the head alone, since the base is one of
# the things a test may have changed.
find_pull() {
  local head=$1 owner branch
  case $head in
    *:*)
      owner=${head%%:*}
      branch=${head#*:}
      ;;
    *)
      owner=${E2E_REPO%%/*}
      branch=$head
      ;;
  esac
  api GET "/repos/$E2E_REPO/pulls?state=all&head=$owner:$branch&per_page=100" |
    read_json '((p) => (p ? `${p.number} ${p.merged_at ? "merged" : p.state}` : ""))(json.find((p) => p.state === "open") ?? json[0])'
}

# Opens the pull request from <head>, if it was closed, with <base> as its base, before a push
# replaces its head: GitHub opens a closed pull request again only while its head is the one it
# was closed with. It's no loss if GitHub refuses: `ensure_pull` tries again after the push.
reopen_pull() {
  local head=$1 base=$2 found number
  found=$(find_pull "$head")
  if [ "${found#* }" = closed ]; then
    number=${found% *}
    api PATCH "/repos/$E2E_REPO/pulls/$number" "$(json_of state=open base="$base")" >/dev/null ||
      echo "GitHub wouldn't open $E2E_REPO#$number yet" >&2
  fi
}

# Makes sure a pull request from <head> into <base> is open in rozed-dev/e2e, with <title> and
# <body> and the fixture label, and sets `pull` to its number. One that was closed is opened again,
# and one whose base was changed is put back; one that was merged can't be, and fails.
ensure_pull() {
  local head=$1 base=$2 title=$3 body=$4 found number state
  found=$(find_pull "$head")
  if [ -z "$found" ]; then
    pull=$(api POST "/repos/$E2E_REPO/pulls" \
      "$(json_of title="$title" head="$head" base="$base" body="$body")" | read_json 'json.number')
    echo "opened $E2E_REPO#$pull: $head into $base"
  else
    number=${found% *}
    state=${found#* }
    if [ "$state" = merged ]; then
      echo "code fixtures: $E2E_REPO#$number was merged, which GitHub can't undo" >&2
      return 1
    fi
    api PATCH "/repos/$E2E_REPO/pulls/$number" \
      "$(json_of title="$title" body="$body" base="$base" state=open)" >/dev/null
    pull=$number
    if [ "$state" = closed ]; then
      echo "opened $E2E_REPO#$pull again: $head into $base"
    else
      echo "$E2E_REPO#$pull is open: $head into $base"
    fi
  fi
  api POST "/repos/$E2E_REPO/issues/$pull/labels" "{\"labels\":[\"$LABEL\"]}" >/dev/null
}

# Fails unless GitHub numbered a pull request <actual>, as the script that made it says it is
# numbered, in <name>. Change <name> to what GitHub says, and run the script again.
expect_pull() {
  local actual=$1 expected=$2 name=$3
  if [ "$actual" != "$expected" ]; then
    echo "code fixtures: GitHub numbered a pull request $actual, and $name says $expected" >&2
    return 1
  fi
}

# Deletes what a test wrote on pull request <pull>: rozed-bot's pending review and every review
# comment and conversation comment, since the fixtures hold none. A submitted review can't be
# deleted: one a test submitted with a summary stays, and is said here.
clean_pull() {
  local pull=$1 id submitted
  for id in $(api GET "/repos/$E2E_REPO/pulls/$pull/reviews?per_page=100" |
    read_json 'json.filter((review) => review.state === "PENDING").map((review) => review.id).join(" ")'); do
    api DELETE "/repos/$E2E_REPO/pulls/$pull/reviews/$id" >/dev/null
    echo "#$pull: deleted a pending review"
  done
  for id in $(api GET "/repos/$E2E_REPO/pulls/$pull/comments?per_page=100" |
    read_json 'json.map((comment) => comment.id).join(" ")'); do
    api DELETE "/repos/$E2E_REPO/pulls/comments/$id" >/dev/null
    echo "#$pull: deleted review comment $id"
  done
  for id in $(api GET "/repos/$E2E_REPO/issues/$pull/comments?per_page=100" |
    read_json 'json.map((comment) => comment.id).join(" ")'); do
    api DELETE "/repos/$E2E_REPO/issues/comments/$id" >/dev/null
    echo "#$pull: deleted conversation comment $id"
  done
  submitted=$(api GET "/repos/$E2E_REPO/pulls/$pull/reviews?per_page=100" |
    read_json 'json.filter((review) => review.state !== "PENDING" && review.body !== "").length')
  if [ "$submitted" != 0 ]; then
    echo "#$pull: $submitted submitted reviews were added since, which GitHub can't delete"
  fi
}
