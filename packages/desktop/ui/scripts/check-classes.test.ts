import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sourceFiles } from './classes.ts';

const script = new URL('./check-classes.ts', import.meta.url).pathname;

let folder: string;

/** Writes files, by path under the folder, creating the folders they sit in. */
function write(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(folder, path, '..'), { recursive: true });
    writeFileSync(join(folder, path), content);
  }
}

/** Runs the check on the folder. */
function check() {
  const { status, stderr } = spawnSync(process.execPath, [script, folder], { encoding: 'utf8' });
  return { code: status, stderr };
}

beforeEach(() => {
  // The real path: macOS's temporary folder is a link, and Tailwind lists files by their real paths.
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-classes-')));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('sourceFiles', () => {
  it('lists the files Tailwind reads classes from, of any type', () => {
    write({
      'a.tsx': '',
      'b.ts': '',
      'page.html': '',
      'notes.md': '',
      'nested/view.vue': '',
      'schema.sql': '',
    });
    expect(sourceFiles(folder).map((file) => relative(folder, file))).toEqual([
      'a.tsx',
      'b.ts',
      'nested/view.vue',
      'notes.md',
      'page.html',
      'schema.sql',
    ]);
  });

  it('leaves out stylesheets, dependencies, lock files and binary files', () => {
    write({
      'a.tsx': '',
      'styles.css': '',
      'node_modules/dep/index.js': '',
      'pnpm-lock.yaml': '',
      'logo.png': '',
    });
    expect(sourceFiles(folder).map((file) => relative(folder, file))).toEqual(['a.tsx']);
  });
});

describe('check-classes', () => {
  it('passes a folder of theme classes', () => {
    write({
      'a.tsx': "export const a = 'flex gap-8 hover:bg-hover';",
      'page.html': '<div class="flex gap-8"></div>',
    });
    expect(check()).toEqual({ code: 0, stderr: '' });
  });

  it('fails an arbitrary value in an html file under the folder', () => {
    write({
      'a.tsx': "export const a = 'flex';",
      'nested/page.html': '<p class="p-[31px]">Hi</p>',
    });
    const { code, stderr } = check();
    expect(code).toBe(1);
    expect(stderr).toContain(
      `${relative(process.cwd(), join(folder, 'nested/page.html'))}:1: p-[31px]`,
    );
    expect(stderr).toContain('1 arbitrary value(s).');
  });

  it.each(['!p-[17px]', '*:p-[19px]', '[&>*]:p-[2px]', 'p-(--lo-tabbar-h)'])(
    'fails %s in a script',
    (className) => {
      write({ 'a.tsx': `export const a = 'flex ${className}';` });
      const { code, stderr } = check();
      expect(code).toBe(1);
      expect(stderr).toContain(`:1: ${className} uses an arbitrary value.`);
    },
  );

  it('reads no classes from stylesheets or dependencies', () => {
    write({
      'a.tsx': "export const a = 'flex';",
      'styles.css': '.a { /* p-[31px] */ }',
      'node_modules/dep/index.js': "export const a = 'p-[31px]';",
    });
    expect(check()).toEqual({ code: 0, stderr: '' });
  });
});
