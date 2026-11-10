#!/bin/sh
# Decides whether CI's check job runs for the changes between two commits. Prints check=false
# when every changed path is docs, the brand's files, agent files or the license, and
# check=true otherwise, saying why on stderr. A moved file counts at its old path too, so moving
# code into docs/ still runs the checks. Generated files always run them.
# Usage: sh scripts/changes.sh <base> <head>
set -euf
base=$1
head=$2

# --no-renames lists a moved file as a deletion and an addition, so both paths count.
files=$(git diff --name-only --no-renames "$base...$head")
check=false
IFS='
'
for file in $files; do
  if [ "$(git check-attr linguist-generated -- "$file" | sed 's/.*: //')" = true ]; then
    echo "$file is generated, so the checks run." >&2
    check=true
    break
  fi
  case "$file" in
    docs/* | brand/* | design/*.md | .claude/* | .agents/* | .github/*.md | LICENSE) ;;
    */*)
      echo "$file changed, so the checks run." >&2
      check=true
      break
      ;;
    *.md) ;;
    *)
      echo "$file changed, so the checks run." >&2
      check=true
      break
      ;;
  esac
done
echo "check=$check"
