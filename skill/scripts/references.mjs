#!/usr/bin/env node
// Copies the documents the skill hands agents into its references/ folder, so the skill carries
// them wherever it's installed. No dependencies.
//
//   node skill/scripts/references.mjs
//
// Writes:
//   skill/references/format.md   the overview format, from packages/core/artifact/format.md
//   skill/references/figures.md  how to draw a figure, from design/figures.md

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = join(skill, '..');

const copies = [
  ['packages/core/artifact/format.md', 'references/format.md'],
  ['design/figures.md', 'references/figures.md'],
];

mkdirSync(join(skill, 'references'), { recursive: true });
for (const [from, to] of copies) {
  copyFileSync(join(workspace, from), join(skill, to));
  console.log('wrote', `skill/${to}`);
}
