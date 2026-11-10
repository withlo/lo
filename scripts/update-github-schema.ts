// Vendors GitHub's public GraphQL schema into packages/core/github/graphql/schema.graphql, from the
// github/docs repository, pinned by commit. GitHub updates that copy daily.
//
//   node scripts/update-github-schema.ts [<github/docs commit>]
//
// Without a commit, it takes the head of github/docs's main branch. It then regenerates the query
// types, type checks the package and runs its tests, so a schema change that breaks a query fails
// here, and in the pull request that commits the new schema.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = join(root, 'packages/core/github/graphql/schema.graphql');
const sourcePath = 'src/graphql/data/fpt/schema.docs.graphql';

let commit = process.argv[2];
if (commit === undefined) {
  const head = execFileSync(
    'git',
    ['ls-remote', 'https://github.com/github/docs.git', 'refs/heads/main'],
    { encoding: 'utf8' },
  );
  commit = head.split('\t')[0];
}
if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
  console.error(`update-github-schema: not a commit: ${commit}`);
  process.exit(1);
}

const url = `https://raw.githubusercontent.com/github/docs/${commit}/${sourcePath}`;
const response = await fetch(url);
if (!response.ok) {
  console.error(`update-github-schema: ${url} answered ${response.status}`);
  process.exit(1);
}
const header = [
  `# GitHub's public GraphQL schema, from github/docs@${commit} (${sourcePath}).`,
  "# Written by scripts/update-github-schema.ts; don't edit by hand.",
  '',
].join('\n');
writeFileSync(schema, header + (await response.text()));
console.log(`update-github-schema: wrote ${schema} from github/docs@${commit}`);

const run = (...args: string[]) => execFileSync('pnpm', args, { cwd: root, stdio: 'inherit' });
run('nx', 'run', 'github:codegen', '--skip-nx-cache');
run('nx', 'run-many', '-p', 'github', '-t', 'typecheck', 'test', '--skip-nx-cache');
