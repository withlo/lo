import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, onTestFinished, test } from 'vitest';

import { checkBoundaries, isTest, type Project, type Violation } from './check.ts';

function project(root: string, ...tags: string[]): Project {
  const name = root.split('/').at(-1) ?? root;
  return { name, root, tags, packageName: `@lo/${name}` };
}

const github = project('packages/core/github', 'platform:core');
const review = project('packages/core/review', 'platform:core');
const markdown = project('packages/core/markdown', 'platform:core', 'license:mit');
const artifact = project('packages/core/artifact', 'platform:core', 'license:mit');
const git = project('packages/desktop/git', 'platform:desktop');
const ui = project('packages/desktop/ui', 'platform:desktop');
const desktop = project('apps/desktop');
const skill = project('skill', 'license:mit');
const checker = project('skill/checker', 'license:mit');
const testing = project('testing');

const everyProject = [
  github,
  review,
  markdown,
  artifact,
  git,
  ui,
  desktop,
  skill,
  checker,
  testing,
];

/** MIT projects carry their own license. */
const licenses = {
  'packages/core/markdown/LICENSE': 'MIT License',
  'packages/core/artifact/LICENSE': 'MIT License',
  'skill/LICENSE': 'MIT License',
  'skill/checker/LICENSE': 'MIT License',
};

/** Writes a made-up workspace to a temporary folder and checks it. */
function check(files: Record<string, string>, projects: Project[] = everyProject): Violation[] {
  const root = mkdtempSync(join(tmpdir(), 'lo-boundaries-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const { root: folder } of projects) mkdirSync(join(root, folder), { recursive: true });
  for (const [path, source] of Object.entries({ ...licenses, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return checkBoundaries(root, projects);
}

/** A violation at `where` whose message contains `text`. */
function violation(where: string, text: string) {
  return { where, message: expect.stringContaining(text) };
}

test('a workspace that keeps every rule passes', () => {
  expect(
    check({
      'packages/core/github/src/index.ts': `import { pr } from './pr.ts';\nexport { pr };`,
      'packages/core/github/src/pr.ts': `export const pr = 1;`,
      'packages/core/github/src/pr.test.ts': [
        `import { readFileSync } from 'node:fs';`,
        `import { replay } from '@lo/testing';`,
        `import { pr } from './pr.ts';`,
      ].join('\n'),
      'packages/core/github/test/polling.test.ts': `import { replay } from '@lo/testing';`,
      'packages/core/review/src/index.ts': `import type { Pr } from '@lo/github';\nimport { z } from 'zod';`,
      'packages/core/markdown/src/index.ts': `import { unified } from 'unified';`,
      'packages/core/artifact/src/index.ts': `export * from '@lo/markdown';`,
      'packages/desktop/git/src/index.ts': `import { execFile } from 'node:child_process';\nimport type { Pr } from '@lo/review';`,
      'packages/desktop/git/test/helpers.ts': `import { makeRepo } from '@lo/testing';`,
      'packages/desktop/ui/src/index.tsx': `import { tree } from '@lo/markdown';\nimport '@lo/design/css/index.css';`,
      'apps/desktop/src/main/index.ts': `import { app } from 'electron';\nimport { clone } from '@lo/git';\nimport { Tab } from '@lo/ui';`,
      'apps/desktop/e2e/smoke.ts': `import { serve } from '@lo/testing';`,
      'skill/checker/src/index.ts': `import { parse } from '@lo/artifact';\nimport { readFile } from 'node:fs/promises';`,
      'testing/src/index.ts': `import type { Pr } from '@lo/github';\nimport { mkdtemp } from 'node:fs/promises';`,
    }),
  ).toEqual([]);
});

describe('tags', () => {
  test('a project in packages/core or packages/desktop takes the matching platform tag', () => {
    const projects = [
      project('packages/core/github'),
      project('packages/core/review', 'platform:core', 'platform:desktop'),
      project('packages/desktop/git', 'platform:core'),
      project('packages/desktop/ui', 'platform:desktop'),
    ];
    expect(check({}, projects)).toEqual([
      violation('packages/core/github', 'takes the tag platform:core, and has none'),
      violation(
        'packages/core/review',
        'takes the tag platform:core, not platform:core, platform:desktop',
      ),
      violation('packages/desktop/git', 'takes the tag platform:desktop, not platform:core'),
    ]);
  });

  test('projects elsewhere take no platform tag', () => {
    expect(check({}, [project('skill', 'platform:core'), project('testing')])).toEqual([
      violation(
        'skill',
        'only projects in packages/core/ and packages/desktop/ take a platform tag',
      ),
    ]);
  });

  test('license:mit is the only license tag, and an MIT project has its own LICENSE', () => {
    const projects = [project('testing', 'license:apache'), project('skill', 'license:mit')];
    const violations = checkWithoutLicenses(projects);
    expect(violations).toEqual([
      violation('skill', 'needs the MIT license in its own LICENSE file'),
      violation('testing', 'the only license tag is license:mit'),
    ]);
  });
});

function checkWithoutLicenses(projects: Project[]): Violation[] {
  const root = mkdtempSync(join(tmpdir(), 'lo-boundaries-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const { root: folder } of projects) mkdirSync(join(root, folder), { recursive: true });
  return checkBoundaries(root, projects);
}

describe('core projects', () => {
  test('use no Node built-in or Electron, however they refer to it', () => {
    expect(
      check({
        'packages/core/github/src/index.ts': [
          `import { readFile } from 'node:fs';`,
          `import os from 'os';`,
          `export * from 'node:path';`,
          `const { spawn } = await import('child_process');`,
          `const crypto = require('crypto');`,
          `import type { BrowserWindow } from 'electron';`,
          `type Port = import('electron').MessagePortMain;`,
          `/// <reference types="node" />`,
          `import { ipcRenderer } from 'electron/renderer';`,
        ].join('\n'),
      }),
    ).toEqual([
      violation('packages/core/github/src/index.ts:1', 'imports node:fs, a Node built-in'),
      violation('packages/core/github/src/index.ts:2', 'imports os, a Node built-in'),
      violation('packages/core/github/src/index.ts:3', 'imports node:path, a Node built-in'),
      violation('packages/core/github/src/index.ts:4', 'imports child_process, a Node built-in'),
      violation('packages/core/github/src/index.ts:5', 'imports crypto, a Node built-in'),
      violation(
        'packages/core/github/src/index.ts:6',
        "imports electron. Core projects run anywhere, so they can't use Electron",
      ),
      violation('packages/core/github/src/index.ts:7', 'imports electron.'),
      violation('packages/core/github/src/index.ts:8', 'imports node, a Node built-in'),
      violation('packages/core/github/src/index.ts:9', 'imports electron/renderer.'),
    ]);
  });

  test('import only core projects, by name or by path', () => {
    expect(
      check({
        'packages/core/review/src/index.ts': [
          `import { clone } from '@lo/git';`,
          `import { read } from '../../../desktop/git/src/read.ts';`,
          `import { parse } from '@lo/checker/parse';`,
          `import { pr } from '@lo/github';`,
        ].join('\n'),
      }),
    ).toEqual([
      violation(
        'packages/core/review/src/index.ts:1',
        "imports git (@lo/git), which isn't a core project",
      ),
      violation(
        'packages/core/review/src/index.ts:2',
        "imports git (../../../desktop/git/src/read.ts), which isn't a core project",
      ),
      violation(
        'packages/core/review/src/index.ts:3',
        "imports checker (@lo/checker/parse), which isn't a core project",
      ),
    ]);
  });

  test('have tests that may use Node and testing, but not Electron or other projects', () => {
    expect(
      check({
        'packages/core/github/src/poll.test.ts': [
          `import { setTimeout } from 'node:timers/promises';`,
          `import { replay } from '@lo/testing';`,
          `import { app } from 'electron';`,
          `import { clone } from '@lo/git';`,
        ].join('\n'),
      }),
    ).toEqual([
      violation('packages/core/github/src/poll.test.ts:3', 'imports electron.'),
      violation(
        'packages/core/github/src/poll.test.ts:4',
        "imports git (@lo/git), which isn't a core project",
      ),
    ]);
  });
});

test('MIT projects import only MIT projects, and their tests may import testing', () => {
  expect(
    check({
      'packages/core/markdown/src/index.ts': `import type { Pr } from '@lo/github';`,
      'packages/core/artifact/src/index.ts': `import { tree } from '@lo/markdown';`,
      'packages/core/artifact/src/parse.test.ts': `import { examples } from '@lo/testing';`,
      'skill/checker/src/index.ts': `import { clone } from '@lo/git';\nimport { parse } from '@lo/artifact';`,
    }),
  ).toEqual([
    violation(
      'packages/core/markdown/src/index.ts:1',
      "imports github (@lo/github), which isn't MIT-licensed",
    ),
    violation('skill/checker/src/index.ts:1', "imports git (@lo/git), which isn't MIT-licensed"),
  ]);
});

test('nothing imports an app', () => {
  expect(
    check({
      'packages/desktop/ui/src/index.ts': `import { contract } from '@lo/desktop';`,
      'testing/src/index.ts': `import { start } from '../../apps/desktop/src/main/index.ts';`,
      'apps/desktop/src/main/index.ts': `import { contract } from '../features/tab/contract.ts';`,
    }),
  ).toEqual([
    violation(
      'packages/desktop/ui/src/index.ts:1',
      'imports the app desktop (@lo/desktop). Nothing imports an app.',
    ),
    violation(
      'testing/src/index.ts:1',
      'imports the app desktop (../../apps/desktop/src/main/index.ts)',
    ),
  ]);
});

test('only tests import testing', () => {
  expect(
    check({
      'packages/desktop/git/src/index.ts': `import { makeRepo } from '@lo/testing';`,
      'packages/desktop/git/src/clone.test.ts': `import { makeRepo } from '@lo/testing';`,
      'packages/desktop/git/test/fetch.ts': `import { makeRepo } from '@lo/testing';`,
      'apps/desktop/e2e/open.ts': `import { serve } from '@lo/testing/server';`,
      'apps/desktop/src/main/github.ts': `import { serve } from '@lo/testing/server';`,
    }),
  ).toEqual([
    violation(
      'apps/desktop/src/main/github.ts:1',
      'imports testing (@lo/testing/server). Only tests do',
    ),
    violation(
      'packages/desktop/git/src/index.ts:1',
      'imports testing (@lo/testing). Only tests do',
    ),
  ]);
});

test('a nested project owns its own files', () => {
  expect(
    check({
      'skill/checker/src/index.ts': `import { clone } from '@lo/git';`,
      'skill/install.ts': `import { parse } from '@lo/checker';`,
    }),
  ).toEqual([
    violation('skill/checker/src/index.ts:1', "imports git (@lo/git), which isn't MIT-licensed"),
  ]);
});

test('dependencies, build output, test data and hidden folders are skipped', () => {
  const nodeImport = `import { readFile } from 'node:fs';`;
  expect(
    check({
      'packages/core/github/node_modules/dep/index.js': nodeImport,
      'packages/core/github/dist/index.js': nodeImport,
      'packages/core/github/.tsbuild/index.d.ts': nodeImport,
      'packages/core/github/src/fixtures/hostile.ts': `import { app } from 'electron'; ((`,
    }),
  ).toEqual([]);
});

test("a file that doesn't parse is reported, since its imports can't be checked", () => {
  expect(
    check({ 'packages/core/github/src/index.ts': `import fs from 'node:fs';\nconst = ;` }),
  ).toEqual([violation('packages/core/github/src/index.ts:2', "doesn't parse")]);
});

test.each([
  ['src/pr.test.ts', true],
  ['src/view.test.tsx', true],
  ['test/polling.ts', true],
  ['src/test/helpers.ts', true],
  ['e2e/smoke.spec.ts', true],
  ['src/pr.ts', false],
  ['src/testing.ts', false],
  ['src/latest/index.ts', false],
])('isTest(%s) is %s', (path, expected) => {
  expect(isTest(path)).toBe(expected);
});
