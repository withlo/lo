#!/usr/bin/env node
// Fails if a file in the given folder draws a Base UI popup of its own: a dialog, a menu, a
// popover, a tooltip, a toast. The shared pieces draw them (scripts/popups.ts names which), so
// each comes and goes by the same move and gives focus back the same way. It also fails when a file
// excused for now no longer needs to be, so the list of those only shrinks.
//
//   node scripts/check-popups.ts src

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { sourceFiles } from './classes.ts';
import { findPopups, NOT_YET, SHARED } from './popups.ts';

const folder = resolve(process.argv[2] ?? 'src');
const scripts = /\.[cm]?[jt]sx?$/;
const tests = /\.test\.[cm]?[jt]sx?$/;

const drawing = new Set<string>();
let failed = 0;
for (const file of sourceFiles(folder)) {
  if (!scripts.test(file) || tests.test(file)) continue;
  const path = relative(folder, file).replaceAll('\\', '/');
  const found = findPopups(file, readFileSync(file, 'utf8'));
  if (found.length === 0) continue;
  drawing.add(path);
  if (SHARED.includes(path) || NOT_YET.includes(path)) continue;
  for (const { line, module } of found) {
    console.error(`${relative(process.cwd(), file)}:${line}: imports ${module}.`);
    failed += 1;
  }
}
if (failed > 0) {
  console.error(
    `\n${failed} popup(s) drawn outside the shared pieces. Use Dialog, ContextMenu, Popover, Tooltip, Palette or ToastStack from this package, which hold how a popup comes, goes and gives focus back.`,
  );
}
const stale = NOT_YET.filter((path) => !drawing.has(path));
for (const path of stale) {
  console.error(`${path} no longer draws a popup of its own. Take it off NOT_YET in popups.ts.`);
}
if (failed > 0 || stale.length > 0) process.exit(1);
