#!/usr/bin/env node
// Fails on Tailwind's bracketed arbitrary values in the given folders' source files.
//
//   node scripts/check-classes.ts src [more folders]

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { findArbitrary } from './classes.ts';

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const findings = process.argv
  .slice(2)
  .flatMap(sources)
  .flatMap((file) => findArbitrary(file, readFileSync(file, 'utf8')));
for (const { file, line, className } of findings) {
  console.error(`${relative(process.cwd(), file)}:${line}: ${className} uses an arbitrary value.`);
}
if (findings.length > 0) {
  console.error(
    `\n${findings.length} arbitrary value(s). Use the theme's tokens, or add a utility to styles.css.`,
  );
  process.exit(1);
}
