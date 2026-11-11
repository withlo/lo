// A stand-in for GitHub's `gh` for the accounts feature's tests: a shell script that answers the
// commands Lo runs, and fails if its environment holds a token or would let it prompt. Tests never
// run the gh on `PATH`, which holds the tokens of whoever runs them.

import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { onTestFinished } from 'vitest';

/** What the stand-in prints for `gh auth status --json hosts`, as gh 2.103 prints it. */
export const STATUS = `{"hosts":{"github.com":[
  {"state":"success","active":true,"host":"github.com","login":"rozed-bot","tokenSource":"keyring","scopes":"read:org, repo, workflow","gitProtocol":"https"},
  {"state":"success","active":false,"host":"github.com","login":"someone-else","tokenSource":"keyring","scopes":"gist, read:org, repo","gitProtocol":"https"},
  {"state":"error","active":false,"host":"github.com","login":"broken","tokenSource":"keyring","gitProtocol":"https"}
]}}`;

/** The stand-in tokens it prints, never real ones. */
export const GH_TOKEN_FOR_BOT = 'gho_FAKE_FROM_GH';
export const GH_TOKEN_FOR_SOMEONE_ELSE = 'gho_FAKE_SOMEONE_ELSE';

const SCRIPT = `#!/bin/sh
for name in GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN GH_HOST; do
  if eval "[ -n \\"\\\${$name+set}\\" ]"; then
    echo "$name is set in gh's environment" >&2
    exit 3
  fi
done
if [ "$GH_PROMPT_DISABLED" != 1 ]; then
  echo "gh could prompt" >&2
  exit 4
fi
here="$(dirname "$0")"
printf '%s\\n' "$*" >> "$here/asked"
case "$*" in
  "--version")
    printf 'gh version 2.103.3 (2026-10-26)\\nhttps://github.com/cli/cli/releases/tag/v2.103.3\\n' ;;
  "auth status --json hosts --hostname github.com")
    cat "$here/status.json" ;;
  "auth token --hostname github.com --user=rozed-bot")
    printf '${GH_TOKEN_FOR_BOT}\\n' ;;
  "auth token --hostname github.com --user=someone-else")
    printf '${GH_TOKEN_FOR_SOMEONE_ELSE}\\n' ;;
  *)
    echo "no oauth token found for github.com" >&2
    exit 1 ;;
esac
`;

/** A stand-in gh in a folder of its own, removed once the test ends. */
export interface FakeGh {
  /** The folder it's in, its real path. */
  readonly folder: string;
  /** The script itself. */
  readonly program: string;
}

/**
 * Writes the stand-in gh, which lists `status`, into a new folder only this user can change, or
 * writes `script` in its place.
 */
export function fakeGh(options: { status?: string; script?: string } = {}): FakeGh {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-gh-')));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  const program = join(folder, 'gh');
  writeFileSync(program, options.script ?? SCRIPT);
  chmodSync(program, 0o755);
  writeFileSync(join(folder, 'status.json'), options.status ?? STATUS);
  return { folder, program };
}
