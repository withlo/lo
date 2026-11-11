import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

/** Runs the check on the folder, with `tsc` found on `path` first when given. */
function check(path?: string) {
  const env = { ...process.env, PATH: [path, process.env.PATH].filter(Boolean).join(':') };
  const { status, stderr } = spawnSync(process.execPath, [script, folder], {
    encoding: 'utf8',
    env,
  });
  return { code: status, stderr };
}

/**
 * A folder holding a `tsc` that runs the real one, but pipes what `--explainFiles` prints through
 * `filter`, a shell command, as a tsc whose output reads differently would.
 */
function explainingThrough(filter: string): string {
  const real = execFileSync('sh', ['-c', 'command -v tsc'], { encoding: 'utf8' }).trim();
  const bin = join(folder, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'tsc'),
    [
      `#!/bin/sh`,
      `case " $* " in *" --explainFiles "*) "${real}" "$@" | ${filter}; exit 0;; esac`,
      `exec "${real}" "$@"`,
    ].join('\n'),
  );
  chmodSync(join(bin, 'tsc'), 0o755);
  return bin;
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
    'package.json': JSON.stringify({
      name: '@lo/ui',
      type: 'module',
      exports: { './code': './src/code/index.ts', './code/view.css': './src/code/view.css' },
    }),
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

test('fails on CodeMirror any export reaches, not only the code views', () => {
  write({
    ...view,
    'package.json': JSON.stringify({
      name: '@lo/ui',
      type: 'module',
      exports: { '.': { types: './src/index.ts' }, './code': './src/code/index.ts' },
    }),
    'src/fixtures/editor.ts': [
      `import { EditorView } from '@codemirror/view';`,
      `export const editorOf = (parent: HTMLElement): EditorView => new EditorView({ parent });`,
    ].join('\n'),
    'src/index.ts': `export { editorOf } from './fixtures/editor.ts';`,
  });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`src/index.ts → src/fixtures/editor.ts → @codemirror/view`);
});

test('fails on a global type a file adds, even one imported only for a value', () => {
  write({
    ...view,
    'src/code/env.ts': [
      `import type { EditorView } from '@codemirror/view';`,
      `declare global { interface Window { editor?: EditorView } }`,
      `export const ready = true;`,
    ].join('\n'),
    'src/code/view.ts': `${view['src/code/view.ts']}\nimport { ready } from './env.ts';\nexport const seen = ready;`,
  });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`src/code/env.ts (adds to types outside it) → @codemirror/view`);
});

test("fails on a type a file adds to another of the package's modules", () => {
  write({
    ...view,
    'src/code/more.ts': [
      `import type { EditorView } from '@codemirror/view';`,
      `declare module './api.ts' { interface DiffView { editor?: EditorView } }`,
      `export {};`,
    ].join('\n'),
  });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`src/code/more.ts (adds to types outside it) → @codemirror/view`);
});

test("passes when a file adds only to CodeMirror's own types", () => {
  write({
    ...view,
    'src/code/more.ts': [
      `import type { DiffView } from './api.ts';`,
      `declare module '@codemirror/view' { interface EditorView { lo?: DiffView } }`,
      `export {};`,
    ].join('\n'),
  });
  expect(check()).toEqual({ code: 0, stderr: '' });
});

test('fails on a declaration file the package wrote, re-exported or referenced', () => {
  write({
    ...view,
    'src/code/types.d.ts': [
      `import type { EditorView } from '@codemirror/view';`,
      `export type Editor = EditorView;`,
    ].join('\n'),
    'src/code/globals.d.ts': `interface Window { editor?: import('@codemirror/state').EditorState }`,
    'src/code/view.ts': `/// <reference path="./globals.d.ts" />\n${view['src/code/view.ts']}`,
    'src/code/index.ts': `${view['src/code/index.ts']}\nexport type { Editor } from './types.ts';`,
  });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`src/code/index.ts → src/code/types.d.ts → @codemirror/view`);
  expect(stderr).toContain(`src/code/globals.d.ts (adds to types outside it) → @codemirror/state`);
});

test("fails on an export it can't follow", () => {
  write({
    ...view,
    'package.json': JSON.stringify({ name: '@lo/ui', exports: { './*': './src/*.ts' } }),
  });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`package.json exports a pattern, ./src/*.ts`);
});

test("fails when tsc's list of what it read leaves out where it started", () => {
  write(view);
  const { code, stderr } = check(explainingThrough('grep -v "src/code/index.d.ts"'));
  expect(code).toBe(1);
  expect(stderr).toContain(`tsc's list of the files it read leaves out`);
});

test("still fails on CodeMirror when tsc's explanations can't be followed", () => {
  write({
    ...view,
    'src/code/index.ts': `${view['src/code/index.ts']}\nexport { EditorView } from '@codemirror/view';`,
  });
  const { code, stderr } = check(explainingThrough(`grep -v '^[[:space:]]'`));
  expect(code).toBe(1);
  expect(stderr).toMatch(/^ {2}@codemirror\/view$/m);
});

test("fails when tsc can't emit the declarations", () => {
  write({ ...view, 'src/code/api.ts': `export const view: number = 'view';` });
  const { code, stderr } = check();
  expect(code).toBe(1);
  expect(stderr).toContain(`tsc couldn't emit the declarations`);
});
