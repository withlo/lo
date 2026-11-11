import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { buildOf } from './build.ts';

/** A folder holding `files`, by path. */
function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lo-build-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

describe('buildOf', () => {
  const main = { 'index.js': 'main', 'chunks/github-1.js': 'polls' };

  it('names the same code the same, wherever it sits and whenever it was written', () => {
    expect(buildOf(folder(main))).toBe(buildOf(folder(main)));
    expect(buildOf(folder(main))).toMatch(/^[0-9a-f]{16}$/);
  });

  it('names a build anew when any file in it changes, a chunk included', () => {
    const built = buildOf(folder(main));
    expect(buildOf(folder({ ...main, 'index.js': 'main 2' }))).not.toBe(built);
    expect(buildOf(folder({ ...main, 'chunks/github-1.js': 'polls 2' }))).not.toBe(built);
    expect(buildOf(folder({ ...main, 'chunks/more.js': '' }))).not.toBe(built);
  });

  it('tells moved code from changed code', () => {
    expect(buildOf(folder({ 'a.js': 'x', 'b.js': '' }))).not.toBe(
      buildOf(folder({ 'a.js': '', 'b.js': 'x' })),
    );
  });
});
