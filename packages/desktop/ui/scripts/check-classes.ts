#!/usr/bin/env node
// Fails on Tailwind's arbitrary values (`text-[11px]`, `p-(--lo-tabbar-h)`, `[&>*]:p-4`) in the
// files of the given folders that Tailwind reads classes from, whatever their type.
//
//   node scripts/check-classes.ts src [more folders]

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { findArbitrary, sourceFiles } from './classes.ts';

const findings = process.argv
  .slice(2)
  .flatMap(sourceFiles)
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
