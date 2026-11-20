import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bundledPackages, collector, packageReader, sorted } from './packages.ts';

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lo-notices-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes `files` under `root`, making the folders. */
function put(files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const manifest = (fields: Record<string, unknown>) => JSON.stringify(fields);

describe('packageReader', () => {
  it("reads a package's name, version, license, license text and NOTICE, trimmed", () => {
    put({
      'node_modules/a/package.json': manifest({ name: 'a', version: '1.2.3', license: ' MIT ' }),
      'node_modules/a/LICENSE': '\nMIT License\n\nCopyright (c) A\n\n',
      'node_modules/a/NOTICE.txt': 'a notice\n',
      'node_modules/a/lib/index.js': '',
    });
    const read = packageReader();
    expect(read(join(root, 'node_modules/a/lib/index.js'))).toEqual({
      name: 'a',
      version: '1.2.3',
      license: 'MIT',
      text: 'MIT License\n\nCopyright (c) A',
      notice: 'a notice',
    });
  });

  it("goes up past a package.json that names no package, as one that marks a folder's module type", () => {
    put({
      'node_modules/a/package.json': manifest({ name: 'a', version: '1.0.0', license: 'ISC' }),
      'node_modules/a/LICENSE.md': 'ISC',
      'node_modules/a/esm/package.json': manifest({ type: 'module' }),
      'node_modules/a/esm/deep/index.js': '',
    });
    expect(packageReader()(join(root, 'node_modules/a/esm/deep/index.js'))).toMatchObject({
      name: 'a',
      license: 'ISC',
      text: 'ISC',
    });
  });

  it('takes pnpm’s layout, and the file of a scoped package, whatever the query on its id', () => {
    const folder = 'node_modules/.pnpm/@s+b@2.0.0/node_modules/@s/b';
    put({
      [`${folder}/package.json`]: manifest({
        name: '@s/b',
        version: '2.0.0',
        license: 'Apache-2.0',
      }),
      [`${folder}/COPYING`]: 'Apache',
      [`${folder}/dist/x.js`]: '',
    });
    expect(packageReader()(`${join(root, folder)}/dist/x.js?commonjs-es-import`)).toMatchObject({
      name: '@s/b',
      version: '2.0.0',
      license: 'Apache-2.0',
      text: 'Apache',
      notice: undefined,
    });
  });

  it('knows a package without a license, a license it can’t read, a license file or a version', () => {
    put({
      'node_modules/none/package.json': manifest({ name: 'none' }),
      'node_modules/none/index.js': '',
      'node_modules/legacy/package.json': manifest({
        name: 'legacy',
        version: '1.0.0',
        license: { type: 'MIT' },
      }),
      'node_modules/legacy/index.js': '',
    });
    const read = packageReader();
    expect(read(join(root, 'node_modules/none/index.js'))).toEqual({
      name: 'none',
      version: '0.0.0',
      license: undefined,
      text: undefined,
      notice: undefined,
    });
    expect(read(join(root, 'node_modules/legacy/index.js'))?.license).toBeUndefined();
  });

  it('reads nothing of what is not in node_modules, or is not a file of a module', () => {
    put({
      'package.json': manifest({ name: 'lo', version: '0.0.0', license: 'GPL-3.0-only' }),
      'src/lo.ts': '',
    });
    const read = packageReader();
    expect(read(join(root, 'src/lo.ts'))).toBeUndefined();
    expect(read('\0commonjsHelpers.js')).toBeUndefined();
    expect(read(join(root, 'node_modules/missing/index.js'))).toBeUndefined();
  });

  it('gives the same package for each of its files', () => {
    put({
      'node_modules/a/package.json': manifest({ name: 'a', version: '1.0.0', license: 'MIT' }),
      'node_modules/a/one.js': '',
      'node_modules/a/two.js': '',
    });
    const read = packageReader();
    expect(read(join(root, 'node_modules/a/one.js'))).toBe(
      read(join(root, 'node_modules/a/two.js')),
    );
  });
});

describe('sorted', () => {
  it('lists each package and version once, in order', () => {
    const a1 = { name: 'a', version: '1.0.0' };
    const a2 = { name: 'a', version: '2.0.0' };
    const b = { name: 'b', version: '1.0.0' };
    expect(sorted([b, a2, a1, { ...a1 }, b])).toEqual([a1, a2, b]);
  });
});

/** A bundle with one chunk, whose one module is `id` under the root. */
const chunk = (id: string) => ({
  'x.js': { type: 'chunk' as const, moduleIds: [join(root, id)] },
});

/** The plugin's hooks, which the build calls with a context of its own. */
function hooks() {
  const made = bundledPackages('bundled.json');
  const { configResolved, generateBundle } = made;
  if (typeof configResolved !== 'function' || typeof generateBundle !== 'function') {
    throw new Error('The plugin has no hooks.');
  }
  const emitFile = vi.fn<(file: { type: string; fileName: string; source: string }) => string>(
    () => '',
  );
  return {
    emitFile,
    resolve: (folder: string) => Reflect.apply(configResolved, {}, [{ root: folder }]),
    generate: async (modules: string[], isWrite: boolean) => {
      const bundle = { 'index.js': { type: 'chunk', moduleIds: modules } };
      await Reflect.apply(generateBundle, { emitFile }, [{}, bundle, isWrite]);
    },
  };
}

describe('collector', () => {
  beforeEach(() => {
    put({
      'node_modules/a/package.json': manifest({ name: 'a', version: '1.0.0', license: 'MIT' }),
      'node_modules/a/index.js': '',
      'node_modules/f/package.json': manifest({ name: 'f', version: '2.0.0', license: 'OFL-1.1' }),
      'node_modules/f/files/f.woff2': '',
      'src/window/x.css': '',
    });
  });

  it("lists the packages of a chunk's modules and of an asset's source files, named from the build's root", () => {
    const found = collector(() => join(root, 'src/window'));
    found.add({
      'index.js': {
        type: 'chunk',
        moduleIds: [join(root, 'node_modules/a/index.js'), join(root, 'src/window/x.css')],
      },
      'f.woff2': { type: 'asset', originalFileNames: ['../../node_modules/f/files/f.woff2'] },
    });
    expect(found.list()).toEqual([
      { name: 'a', version: '1.0.0', license: 'MIT', text: undefined, notice: undefined },
      { name: 'f', version: '2.0.0', license: 'OFL-1.1', text: undefined, notice: undefined },
    ]);
  });

  it('keeps what earlier outputs held, so a package is listed once however many have it', () => {
    const found = collector(() => root);
    found.add(chunk('node_modules/f/files/f.woff2'));
    found.add(chunk('node_modules/a/index.js'));
    found.add(chunk('node_modules/a/index.js'));
    expect(found.list().map((each) => each.name)).toEqual(['a', 'f']);
  });
});

describe('bundledPackages', () => {
  beforeEach(() => {
    put({
      'node_modules/a/package.json': manifest({ name: 'a', version: '1.0.0', license: 'MIT' }),
      'node_modules/a/index.js': '',
      'node_modules/f/package.json': manifest({ name: 'f', version: '2.0.0', license: 'OFL-1.1' }),
      'node_modules/f/index.js': '',
    });
  });

  it('writes nothing for a build that writes nothing, whose packages go in the list of the build that holds it', async () => {
    const { emitFile, resolve, generate } = hooks();
    resolve(root);
    // As a `?modulePath` entry's build is: bundled, and its files handed on to the build that has it.
    await generate([join(root, 'node_modules/f/index.js')], false);
    expect(emitFile).not.toHaveBeenCalled();
    await generate([join(root, 'node_modules/a/index.js')], true);
    expect(emitFile).toHaveBeenCalledTimes(1);
    const [file] = emitFile.mock.calls[0] ?? [];
    expect(file?.type).toBe('asset');
    expect(file?.fileName).toBe('bundled.json');
    const listed: unknown = JSON.parse(file?.source ?? 'null');
    expect(listed).toEqual([
      { name: 'a', version: '1.0.0', license: 'MIT' },
      { name: 'f', version: '2.0.0', license: 'OFL-1.1' },
    ]);
  });
});
