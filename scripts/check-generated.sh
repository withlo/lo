#!/bin/sh
# Fails when a generated file is out of date: reruns every codegen target and lists the files that
# changed. Changes already in the working tree are left alone and don't count.
# Usage: sh scripts/check-generated.sh (or pnpm check:generated)
set -eu
cd "$(dirname "$0")/.."

# Each changed or untracked file, with a hash of its contents.
snapshot() {
  git ls-files --modified --others --exclude-standard | sort -u | while IFS= read -r file; do
    printf '%s %s\n' "$(git hash-object -- "$file" 2>/dev/null || echo deleted)" "$file"
  done
}

before=$(snapshot)
pnpm exec nx run-many -t codegen --skip-nx-cache --output-style=static
after=$(snapshot)

changed=$(printf '%s\n%s\n' "$before" "$after" | sort | uniq -u | cut -d ' ' -f 2- | sort -u)
if [ -n "$changed" ]; then
  echo "These generated files were out of date, and codegen just rewrote them:" >&2
  printf '  %s\n' "$changed" >&2
  echo "Commit them with the change that caused them." >&2
  exit 1
fi
echo "Generated files are current."
