import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, onTestFinished, test } from 'vitest';

import { checkBoundaries, isTest, type Edge, type Project, type Violation } from './check.ts';

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

interface Workspace {
  files?: Record<string, string>;
  /** Symlinks to make, from their path to their target. */
  links?: Record<string, string>;
  projects?: Project[];
  edges?: Edge[];
  licenses?: boolean;
}

/** Writes a made-up workspace to a temporary folder and checks it. */
function checkWorkspace({
  files = {},
  links = {},
  projects = everyProject,
  edges = [],
  licenses: withLicenses = true,
}: Workspace): Violation[] {
  const root = mkdtempSync(join(tmpdir(), 'lo-boundaries-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const { root: folder } of projects) mkdirSync(join(root, folder), { recursive: true });
  for (const [path, source] of Object.entries({ ...(withLicenses ? licenses : {}), ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  for (const [path, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(target, join(root, path));
  }
  return checkBoundaries(root, projects, edges);
}

function check(files: Record<string, string>, projects?: Project[]): Violation[] {
  return checkWorkspace(projects ? { files, projects } : { files });
}

/** A violation at `where` whose message contains `text`. */
function violation(where: string, text: string) {
  return { where, message: expect.stringContaining(text) };
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

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
      'packages/core/github/package.json': json({
        name: '@lo/github',
        exports: { '.': './src/index.ts' },
        imports: { '#pr': './src/pr.ts' },
        dependencies: { zod: '^4.0.0' },
        devDependencies: { '@lo/testing': 'workspace:*' },
      }),
      'packages/core/github/src/view.ts': `import { pr } from '#pr';`,
      'packages/core/review/src/index.ts': `import type { Pr } from '@lo/github';\nimport { z } from 'zod';\nimport { pr } from 'gh';`,
      'packages/core/review/package.json': json({
        name: '@lo/review',
        dependencies: { '@lo/github': 'workspace:*', gh: 'workspace:@lo/github@*' },
      }),
      'packages/core/markdown/src/index.ts': `import { unified } from 'unified';`,
      'packages/core/artifact/src/index.ts': `export * from '@lo/markdown';`,
      'packages/desktop/git/src/index.ts': [
        `import { execFile } from 'node:child_process';`,
        `import type { Pr } from '@lo/review';`,
        `const parser = await import(\`./parsers/\${'diff'}.ts\`);`,
      ].join('\n'),
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
    expect(check({}, [project('testing', 'platform:core'), project('apps/desktop')])).toEqual([
      violation(
        'testing',
        'only projects in packages/core/ and packages/desktop/ take a platform tag',
      ),
    ]);
  });

  test('projects in the MIT folders are tagged license:mit', () => {
    const projects = [
      project('packages/core/markdown', 'platform:core'),
      project('packages/core/artifact', 'platform:core', 'license:mit'),
      project('skill', 'license:mit'),
      project('skill/checker'),
    ];
    expect(check({}, projects)).toEqual([
      violation('packages/core/markdown', 'which is MIT-licensed, so it takes the tag license:mit'),
      violation(
        'skill/checker',
        'is in skill, which is MIT-licensed, so it takes the tag license:mit',
      ),
    ]);
  });

  test('license:mit is the only license tag, and MIT projects have their own LICENSE', () => {
    const projects = [
      project('testing', 'license:apache'),
      project('scripts', 'license:mit'),
      project('skill/checker', 'license:mit'),
    ];
    expect(checkWorkspace({ projects, licenses: false })).toEqual([
      violation('scripts', 'needs the MIT license in its own LICENSE file'),
      violation('skill/checker', 'needs the MIT license in its own LICENSE file'),
      violation('testing', 'the only license tag is license:mit'),
    ]);
  });
});

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
          `const fs = await import(\`node:fs\`);`,
          `const { app } = require(\`electron\`);`,
        ].join('\n'),
      }),
    ).toEqual([
      violation('packages/core/github/src/index.ts:1', "imports node:fs: that's a Node built-in"),
      violation('packages/core/github/src/index.ts:2', "imports os: that's a Node built-in"),
      violation('packages/core/github/src/index.ts:3', "imports node:path: that's a Node built-in"),
      violation('packages/core/github/src/index.ts:4', "imports child_process: that's a Node"),
      violation('packages/core/github/src/index.ts:5', "imports crypto: that's a Node built-in"),
      violation(
        'packages/core/github/src/index.ts:6',
        "imports electron: core projects run anywhere, so they can't use Electron",
      ),
      violation('packages/core/github/src/index.ts:7', 'imports electron: core projects'),
      violation('packages/core/github/src/index.ts:8', "references node: that's a Node built-in"),
      violation('packages/core/github/src/index.ts:9', 'imports electron/renderer: core projects'),
      violation('packages/core/github/src/index.ts:10', "imports node:fs: that's a Node built-in"),
      violation('packages/core/github/src/index.ts:11', 'imports electron: core projects'),
    ]);
  });

  test('load no module chosen at run time, in their tests too', () => {
    expect(
      check({
        'packages/core/github/src/index.ts': [
          `const name = 'node:fs';`,
          `const fs = await import(name);`,
          `const os = require(['o', 's'].join(''));`,
          `const parser = await import(\`./parsers/\${name}.ts\`);`,
        ].join('\n'),
        'packages/core/github/src/index.test.ts': `const electron = await import(process.env.NAME);`,
      }),
    ).toEqual([
      violation(
        'packages/core/github/src/index.test.ts:1',
        'loads process.env.NAME: the module is chosen at run time',
      ),
      violation(
        'packages/core/github/src/index.ts:2',
        'loads name: the module is chosen at run time',
      ),
      violation(
        'packages/core/github/src/index.ts:3',
        "loads ['o', 's'].join(''): the module is chosen",
      ),
      violation(
        'packages/core/github/src/index.ts:4',
        'loads `./parsers/${name}.ts`: the module is chosen',
      ),
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
      violation('packages/core/review/src/index.ts:1', "imports @lo/git: git isn't a core project"),
      violation(
        'packages/core/review/src/index.ts:2',
        "imports ../../../desktop/git/src/read.ts: that leaves review's folder for git",
      ),
      violation(
        'packages/core/review/src/index.ts:3',
        "imports @lo/checker/parse: checker isn't a core project",
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
      violation('packages/core/github/src/poll.test.ts:3', 'imports electron: core projects'),
      violation(
        'packages/core/github/src/poll.test.ts:4',
        "imports @lo/git: git isn't a core project",
      ),
    ]);
  });
});

describe('paths through node_modules', () => {
  test('resolve to the package they name, even before an install', () => {
    expect(
      check({
        'packages/core/review/src/index.ts': [
          `import { clone } from '../node_modules/@lo/git/src/index.ts';`,
          `import { app } from '../../../../node_modules/electron/index.js';`,
          `import { pr } from '../node_modules/@lo/github/src/index.ts';`,
        ].join('\n'),
      }),
    ).toEqual([
      violation(
        'packages/core/review/src/index.ts:1',
        "imports ../node_modules/@lo/git/src/index.ts: git isn't a core project",
      ),
      violation(
        'packages/core/review/src/index.ts:2',
        "imports ../../../../node_modules/electron/index.js: that leaves review's folder for Electron",
      ),
    ]);
  });
});

describe('symlinks', () => {
  test("a relative import can't follow one out of every project", () => {
    expect(
      checkWorkspace({
        files: {
          'shared/strings.ts': `export const title = 'Lo';`,
          'packages/desktop/ui/src/index.ts': `import { title } from './shared/strings.ts';`,
        },
        links: { 'packages/desktop/ui/src/shared': '../../../../shared' },
      }),
    ).toEqual([
      violation(
        'packages/desktop/ui/src/index.ts:1',
        "imports ./shared/strings.ts: through a symlink, that leaves ui's folder for files outside any project",
      ),
    ]);
  });

  test("a relative import can't follow one into another project, even one it may import", () => {
    expect(
      checkWorkspace({
        files: {
          'packages/desktop/git/src/clone.ts': `export const clone = 1;`,
          'packages/desktop/ui/src/index.ts': `import { clone } from './clone.ts';`,
          'packages/core/review/src/index.ts': `import { clone } from '../modules/git/src/clone.ts';`,
        },
        links: {
          'packages/desktop/ui/src/clone.ts': '../../git/src/clone.ts',
          'packages/core/review/modules/git': '../../../desktop/git',
        },
      }),
    ).toEqual([
      violation(
        'packages/core/review/src/index.ts:1',
        "imports ../modules/git/src/clone.ts: through a symlink, that leaves review's folder for git",
      ),
      violation(
        'packages/desktop/ui/src/index.ts:1',
        "imports ./clone.ts: through a symlink, that leaves ui's folder for git",
      ),
    ]);
  });

  test('a relative import may follow one into node_modules, where it reaches a package', () => {
    expect(
      checkWorkspace({
        files: {
          'node_modules/.pnpm/zod@4.0.0/node_modules/zod/index.js': `export const z = {};`,
          'node_modules/electron/index.js': `export const app = {};`,
          'packages/desktop/ui/src/index.ts': `import { z } from './zod/index.js';`,
          'packages/core/github/src/index.ts': `import { app } from './shell/index.js';`,
        },
        links: {
          'packages/desktop/ui/src/zod':
            '../../../../node_modules/.pnpm/zod@4.0.0/node_modules/zod',
          'packages/core/github/src/shell': '../../../../node_modules/electron',
        },
      }),
    ).toEqual([
      violation(
        'packages/core/github/src/index.ts:1',
        "imports ./shell/index.js: core projects run anywhere, so they can't use Electron",
      ),
    ]);
  });
});

describe('package.json', () => {
  test('aliased dependencies are checked, and imports through them too', () => {
    expect(
      check({
        'packages/core/review/package.json': json({
          name: '@lo/review',
          dependencies: {
            vcs: 'workspace:@lo/git@*',
            shell: 'npm:electron@45.2.3',
            local: 'link:../../desktop/ui',
            remote: 'npm:@electron/remote@2.1.3',
          },
        }),
        'packages/core/review/src/index.ts': [
          `import { clone } from 'vcs';`,
          `import { app } from 'shell';`,
          `import { Tab } from 'local/src/tab.tsx';`,
        ].join('\n'),
      }),
    ).toEqual([
      violation(
        'packages/core/review/package.json:4',
        `lists "vcs": "workspace:@lo/git@*" in dependencies: git isn't a core project`,
      ),
      violation(
        'packages/core/review/package.json:5',
        'lists "shell": "npm:electron@45.2.3" in dependencies: core projects',
      ),
      violation(
        'packages/core/review/package.json:6',
        `lists "local": "link:../../desktop/ui" in dependencies: ui isn't a core project`,
      ),
      violation(
        'packages/core/review/package.json:7',
        'lists "remote": "npm:@electron/remote@2.1.3" in dependencies',
      ),
      violation('packages/core/review/src/index.ts:1', "imports vcs: git isn't a core project"),
      violation('packages/core/review/src/index.ts:2', 'imports shell: core projects'),
      violation(
        'packages/core/review/src/index.ts:3',
        "imports local/src/tab.tsx: ui isn't a core project",
      ),
    ]);
  });

  test('dependencies follow the same rules, and only devDependencies may list testing', () => {
    expect(
      check({
        'packages/core/markdown/package.json': json({
          name: '@lo/markdown',
          dependencies: { '@lo/github': 'workspace:*', '@lo/testing': 'workspace:*' },
          devDependencies: { '@lo/testing': 'workspace:*', electron: '45.2.3' },
        }),
        'packages/desktop/ui/package.json': json({
          name: '@lo/ui',
          peerDependencies: { '@lo/desktop': 'workspace:*' },
        }),
      }),
    ).toEqual([
      violation(
        'packages/core/markdown/package.json:4',
        `lists "@lo/github": "workspace:*" in dependencies: github isn't MIT-licensed`,
      ),
      violation(
        'packages/core/markdown/package.json:5',
        `lists "@lo/testing": "workspace:*" in dependencies: that's testing, which only tests use`,
      ),
      violation(
        'packages/core/markdown/package.json:9',
        'lists "electron": "45.2.3" in devDependencies: core projects',
      ),
      violation(
        'packages/desktop/ui/package.json:4',
        "in peerDependencies: that's the app desktop",
      ),
    ]);
  });

  test('imports and exports map only to what the project may import', () => {
    expect(
      check({
        'packages/core/review/package.json': json({
          name: '@lo/review',
          exports: { '.': './src/index.ts', './git': '../../desktop/git/src/index.ts' },
          imports: {
            '#git': '@lo/git',
            '#fs': { node: 'node:fs', default: './src/fs.ts' },
            '#internal/*': './src/internal/*.ts',
          },
        }),
        'packages/core/review/src/index.ts': `import { clone } from '#git';`,
      }),
    ).toEqual([
      violation(
        'packages/core/review/package.json:5',
        `maps "./git" to "../../desktop/git/src/index.ts" in exports: that leaves review's folder for git`,
      ),
      violation(
        'packages/core/review/package.json:8',
        `maps "#git" to "@lo/git" in imports: git isn't a core project`,
      ),
      violation(
        'packages/core/review/package.json:9',
        `maps "#fs" to "node:fs" in imports: that's a Node built-in`,
      ),
    ]);
  });
});

describe('resolution', () => {
  test("an alias in the root package.json can't carry an import across a boundary", () => {
    expect(
      checkWorkspace({
        files: {
          'package.json': json({
            name: 'lo',
            devDependencies: {
              gitroot: 'workspace:@lo/git@*',
              '@lo/github': 'workspace:*',
              shell: 'npm:electron@45.2.3',
              typescript: 'npm:@typescript/typescript6@6.0.2',
              '@typescript/native': 'npm:typescript@7.0.2',
              vitest: '5.1.0',
            },
          }),
          'packages/desktop/git/src/index.ts': `export const clone = 1;`,
          'packages/core/github/src/index.ts': `import { clone } from 'gitroot';`,
        },
        links: { 'node_modules/gitroot': '../packages/desktop/git' },
      }),
    ).toEqual([
      violation(
        'package.json:4',
        `lists "gitroot": "workspace:@lo/git@*" in devDependencies, but the root package.json holds the repo's tooling only`,
      ),
      violation(
        'package.json:5',
        `lists "@lo/github": "workspace:*" in devDependencies, but the root`,
      ),
      violation(
        'package.json:6',
        `lists "shell": "npm:electron@45.2.3" in devDependencies, but the root`,
      ),
      violation('packages/core/github/src/index.ts:1', "imports gitroot: git isn't a core project"),
    ]);
  });

  test("every edge in Nx's project graph keeps the same rules", () => {
    const edges = [
      { source: 'github', target: 'git' },
      { source: 'github', target: 'npm:electron' },
      { source: 'github', target: 'testing' },
      { source: 'github', target: 'npm:zod' },
      { source: 'review', target: 'github' },
      { source: 'markdown', target: 'npm:@electron/remote@2.1.3' },
      { source: 'ui', target: 'desktop' },
      { source: 'checker', target: 'git' },
    ];
    expect(checkWorkspace({ edges })).toEqual([
      violation(
        'packages/core/github',
        "depends on git in Nx's project graph: git isn't a core project",
      ),
      violation(
        'packages/core/github',
        "depends on npm:electron in Nx's project graph: core projects run anywhere",
      ),
      violation(
        'packages/core/markdown',
        "depends on npm:@electron/remote@2.1.3 in Nx's project graph: core projects",
      ),
      violation(
        'packages/desktop/ui',
        "depends on desktop in Nx's project graph: that's the app desktop",
      ),
      violation('skill/checker', "depends on git in Nx's project graph: git isn't MIT-licensed"),
    ]);
  });

  test('reference directives follow the same rules as imports', () => {
    expect(
      check({
        'packages/core/github/src/index.ts': [
          `/// <reference types="electron" />`,
          `/// <reference types="@lo/git" />`,
          `/// <reference path="../../../desktop/git/src/index.d.ts" />`,
          `/// <reference path="./local.d.ts" />`,
          `/// <reference types="@lo/review" />`,
        ].join('\n'),
      }),
    ).toEqual([
      violation(
        'packages/core/github/src/index.ts:1',
        'references electron: core projects run anywhere',
      ),
      violation(
        'packages/core/github/src/index.ts:2',
        "references @lo/git: git isn't a core project",
      ),
      violation(
        'packages/core/github/src/index.ts:3',
        "references ../../../desktop/git/src/index.d.ts: that leaves github's folder for git",
      ),
    ]);
  });

  test('relative imports stay inside their project, wherever they would land', () => {
    expect(
      check({
        'packages/core/github/src/index.ts': `import { pr } from '../../review/src/index.ts';`,
        'packages/desktop/git/src/index.ts': `import config from '../../../../vitest.config.ts';`,
        'skill/install.ts': `import { check } from './checker/src/index.ts';`,
        'skill/checker/src/index.ts': `import { parse } from './parse.ts';`,
      }),
    ).toEqual([
      violation('packages/core/github/src/index.ts:1', "that leaves github's folder for review"),
      violation(
        'packages/desktop/git/src/index.ts:1',
        "that leaves git's folder for files outside any project",
      ),
      violation('skill/install.ts:1', "that leaves skill's folder for checker"),
    ]);
  });

  test('no tsconfig sets paths, in a project or at the root', () => {
    expect(
      check({
        'packages/core/github/tsconfig.json': json({
          compilerOptions: { paths: { '@lo/git': ['../../desktop/git/src/index.ts'] } },
        }),
        'packages/core/github/tsconfig.lib.json': json({ compilerOptions: { outDir: '.tsbuild' } }),
        'tsconfig.base.json': json({ compilerOptions: { strict: true, paths: {} } }),
      }),
    ).toEqual([
      violation('packages/core/github/tsconfig.json:3', 'sets compilerOptions.paths'),
      violation('tsconfig.base.json:4', 'sets compilerOptions.paths'),
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
      "imports @lo/github: github isn't MIT-licensed",
    ),
    violation('skill/checker/src/index.ts:1', "imports @lo/git: git isn't MIT-licensed"),
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
      "imports @lo/desktop: that's the app desktop, and nothing imports an app",
    ),
    violation(
      'testing/src/index.ts:1',
      "imports ../../apps/desktop/src/main/index.ts: that leaves testing's folder for desktop",
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
      "imports @lo/testing/server: that's testing, which only tests use",
    ),
    violation(
      'packages/desktop/git/src/index.ts:1',
      "imports @lo/testing: that's testing, which only tests use",
    ),
  ]);
});

test('a nested project owns its own files', () => {
  expect(
    check({
      'skill/checker/src/index.ts': `import { clone } from '@lo/git';`,
      'skill/install.ts': `import { parse } from '@lo/checker';`,
    }),
  ).toEqual([violation('skill/checker/src/index.ts:1', "imports @lo/git: git isn't MIT-licensed")]);
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
