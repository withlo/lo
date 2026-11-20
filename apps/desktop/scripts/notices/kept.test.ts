import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { KEPT, keptNotices, type KeptLicense } from './kept.ts';

const root = join(import.meta.dirname, '..', '..', '..', '..');
const syntax = join(root, 'packages', 'desktop', 'syntax');

/** The comment at the top of a query file, as one line: the lines' `; ` and their breaks gone. */
function header(text: string): string {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith(';')) break;
    lines.push(line.slice(1).trim());
  }
  return lines.join(' ');
}

/** Every `.scm` file under `folder`. */
function queryFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.scm'))
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted();
}

/** The licenses a file header can name. */
const LICENSES: readonly KeptLicense[] = ['MIT', 'Apache-2.0', 'GPL-3.0-or-later'];

/** What `grammars.json` holds of each grammar that the notices need. */
const pins = z.object({ grammars: z.array(z.object({ repo: z.string(), commit: z.string() })) });

/** The version a `package.json`, the one at `path` from the repository's root, pins `name` to. */
function pinned(path: string, name: string): string {
  const manifest = z
    .object({
      dependencies: z.record(z.string(), z.string()).optional(),
      devDependencies: z.record(z.string(), z.string()).optional(),
    })
    .parse(JSON.parse(readFileSync(join(root, path), 'utf8')));
  const version = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
  if (version === undefined) throw new Error(`${path} doesn't depend on ${name}.`);
  return version;
}

describe('the kept list', () => {
  it('has an entry for every grammar grammars.json pins, at its commit', () => {
    const { grammars } = pins.parse(
      JSON.parse(readFileSync(join(syntax, 'grammars.json'), 'utf8')),
    );
    expect(grammars.length).toBeGreaterThan(15);
    const missing = grammars
      .filter(
        ({ repo, commit }) => !KEPT.some((entry) => entry.repo === repo && entry.at === commit),
      )
      .map(({ repo, commit }) => `${repo} at ${commit}`);
    expect(missing).toEqual([]);
  });

  it('has an entry for every query copied from elsewhere, at its commit, under its license, with its copyright', () => {
    const copied = queryFiles(join(syntax, 'queries')).filter((file) =>
      readFileSync(file, 'utf8').startsWith('; From '),
    );
    // Zed's own, its extensions' and the grammars' repositories'.
    expect(copied.length).toBeGreaterThan(50);
    const problems = copied.flatMap((file) => {
      const note = header(readFileSync(file, 'utf8'));
      const name = relative(syntax, file);
      const repo = /\(https:\/\/github\.com\/([^/)]+\/[^/)]+)\)/.exec(note)?.[1];
      const commit = /\bat ([0-9a-f]{40})\b/.exec(note)?.[1];
      const license = LICENSES.find((each) => note.includes(`${each}.`));
      if (repo === undefined || commit === undefined || license === undefined) {
        return [`${name} doesn't say its repository, commit and license`];
      }
      const entry = KEPT.find(
        (each) => each.repo === repo && each.at === commit && each.license === license,
      );
      if (entry === undefined)
        return [`${name}: no entry for ${repo} at ${commit} under ${license}`];
      // Each copyright line is in the file's header, though the header may have run two together.
      const words = note.replace(/\s+/g, ' ');
      return entry.copyright
        .filter((line) => !words.includes(line.replace(/^Copyright /, '')))
        .map((line) => `${name}: its header doesn't say "${line}"`);
    });
    expect(problems).toEqual([]);
  });

  it('has the tree-sitter runtime at the release web-tree-sitter is of: its code runs every parse, and its standard library is in every grammar', () => {
    const version = pinned('packages/desktop/syntax/package.json', 'web-tree-sitter');
    expect(
      KEPT.find((entry) => entry.repo === 'tree-sitter/tree-sitter' && entry.license === 'MIT'),
    ).toMatchObject({ at: `v${version}`, copyright: ['Copyright (c) 2018 Max Brunsfeld'] });
  });

  it("has Tailwind CSS at the release the window's stylesheet is built with", () => {
    const version = pinned('apps/desktop/package.json', '@tailwindcss/vite');
    expect(
      KEPT.find((entry) => entry.repo === 'tailwindlabs/tailwindcss' && entry.license === 'MIT'),
    ).toMatchObject({ at: `v${version}`, copyright: ['Copyright (c) Tailwind Labs, Inc.'] });
  });

  it('has nvim-treesitter, which queries say they are based on, under the Apache License', () => {
    const based = queryFiles(join(syntax, 'queries')).filter((file) =>
      readFileSync(file, 'utf8').includes('nvim-treesitter'),
    );
    expect(based.length).toBeGreaterThan(3);
    expect(
      KEPT.filter((entry) => entry.repo === 'nvim-treesitter/nvim-treesitter').map(
        (entry) => entry.license,
      ),
    ).toEqual(['Apache-2.0']);
  });

  it('names whose copyright each MIT entry is, once per repository, commit and license', () => {
    expect(
      KEPT.filter((each) => each.license === 'MIT' && each.copyright.length === 0).map(
        (each) => each.repo,
      ),
    ).toEqual([]);
    const keys = KEPT.map((entry) => `${entry.repo} ${entry.at ?? ''} ${entry.license}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps an Apache-2.0 work’s NOTICE with it: tree-sitter-elixir has one, and no other source does', () => {
    expect(KEPT.filter((entry) => entry.notice !== undefined).map((entry) => entry.repo)).toEqual([
      'elixir-lang/tree-sitter-elixir',
    ]);
    expect(KEPT.find((entry) => entry.notice !== undefined)?.notice).toContain('The Elixir Team');
  });

  it('reads the license files it names from the repository', () => {
    const files = keptNotices(root).filter((entry) => entry.licenseFile !== undefined);
    expect(files.map((entry) => entry.repo)).toEqual(['microsoft/vscode']);
    expect(files[0]?.licenseText).toContain('Copyright (c) 2015 - present Microsoft Corporation');
  });
});
