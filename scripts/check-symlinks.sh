#!/bin/sh
# Checks the links that give every agent one set of rules:
# - every AGENTS.md has a CLAUDE.md -> AGENTS.md symlink beside it, for Claude Code
# - .agents/skills is a symlink to ../.claude/skills, so Codex finds the same skills
# Skips hidden folders, dependencies and build output.
# Usage: sh scripts/check-symlinks.sh [repo root], defaulting to this script's repo.
root=${1:-$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)}
cd "$root" || exit 1
status=0
fail() {
  echo "$1" >&2
  status=1
}

# One path per line, so paths with spaces survive the loop.
IFS='
'
for agents in $(find . \( -name '.?*' -o -name node_modules -o -name dist \) -prune \
  -o -name AGENTS.md -print | sort); do
  claude=$(dirname "$agents")/CLAUDE.md
  claude=${claude#./}
  # The AGENTS.md beside it exists, so a link to it resolves.
  if [ ! -L "$claude" ] || [ "$(readlink "$claude")" != AGENTS.md ]; then
    fail "$claude: must be a symlink to AGENTS.md (ln -s AGENTS.md $claude)"
  fi
done

if [ ! -L .agents/skills ] || [ "$(readlink .agents/skills)" != ../.claude/skills ]; then
  fail ".agents/skills: must be a symlink to ../.claude/skills (ln -s ../.claude/skills .agents/skills)"
elif [ ! -d .agents/skills ]; then
  fail ".agents/skills: doesn't resolve to a folder"
fi

[ "$status" -eq 0 ] && echo "Agent symlinks OK."
exit "$status"
