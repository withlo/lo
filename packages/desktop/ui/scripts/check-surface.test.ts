import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, expect, test } from 'vitest';

const script = fileURLToPath(new URL('./check-surface.ts', import.meta.url));

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

/** A package like ui: Lo's types in api.ts, and a view that uses CodeMirror inside. */
const view = {
  'src/code/api.ts': `export interface DiffView { focus(): void; destroy(): void }`,
  'src/code/view.ts': [
    `import { EditorView } from '@codemirror/view';`,
    `import type { DiffView } from './api.ts';`,
    ``,
    `export function createDiffView(parent: HTMLElement): DiffView {`,
    `  const editor = new EditorView({ parent });`,
    `  return { focus: () => editor.focus(), destroy: () => editor.destroy() };`,
    `}`,
  ].join('\n'),
  'src/code/index.ts': [
    `export type { DiffView } from './api.ts';`,
    `export { createDiffView } from './view.ts';`,
  ].join('\n'),
};

beforeEach(() => {
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-surface-')));
  write({
    'package.json': JSON.stringify({ name: '@lo/ui', type: 'module' }),
    'tsconfig.lib.json': JSON.stringify({
      extends: fileURLToPath(new URL('../../../../tsconfig.window.json', import.meta.url)),
      compilerOptions: { outDir: '.tsbuild/lib' },
      include: ['src/**/*.ts'],
    }),
  });
  // ui's own packages, CodeMirror's among them.
  symlinkSync(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(folder, 'node_modules'),
  );
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

test("passes when the index hands out only Lo's own types", () => {
  write(view);
  expect(check()).toEqual({ code: 0, stderr: '' });
});

test('fails on an EditorView a function returns', () => {
  write({
    ...view,
    'src/code/view.ts': [
      view['src/code/view.ts'],
      `export function editorOf(parent: HTMLElement) {`,
      `  return new EditorView({ parent });`,
      `}`,
    ].join('\n'),
    'src/code/index.ts': `export { createDiffView, editorOf } from './view.ts';`,
  });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`src/code/index.ts → src/code/view.ts → @codemirror/view`);
});

test('fails on a binding from CodeMirror exported again', () => {
  write({
    ...view,
    'src/code/keys.ts': `import { keymap } from '@codemirror/view';\nexport { keymap };`,
    'src/code/index.ts': `${view['src/code/index.ts']}\nexport { keymap } from './keys.ts';`,
  });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`src/code/index.ts → src/code/keys.ts → @codemirror/view`);
});

test('fails on CodeMirror re-exported whole, or reached through a file outside the folder', () => {
  write({
    ...view,
    'src/commands/targets.ts': [
      `import type { SelectionRange } from '@codemirror/state';`,
      `export interface Target { range: SelectionRange }`,
    ].join('\n'),
    'src/code/api.ts': `${view['src/code/api.ts']}\nexport type { Target } from '../commands/targets.ts';`,
    'src/code/index.ts': [
      view['src/code/index.ts'],
      `export type { Target } from './api.ts';`,
      `export * from '@lezer/highlight';`,
    ].join('\n'),
  });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`src/code/index.ts → @lezer/highlight`);
  expect(stderr).toContain(
    `src/code/index.ts → src/code/api.ts → src/commands/targets.ts → @codemirror/state`,
  );
});

test('counts what any file the index reaches exports, not only what the index hands on', () => {
  write({
    ...view,
    'src/code/view.ts': [
      view['src/code/view.ts'],
      `export function focus(editor: EditorView): void {`,
      `  editor.focus();`,
      `}`,
    ].join('\n'),
  });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`src/code/index.ts → src/code/view.ts → @codemirror/view`);
});

test("fails when tsc can't emit the declarations", () => {
  write({ ...view, 'src/code/api.ts': `export const view: number = 'view';` });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`tsc couldn't emit the declarations`);
});
