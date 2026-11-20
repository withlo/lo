import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bundledPackages, collector, merged, packageReader, type Bundled } from './packages.ts';

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
      dir: join(root, 'node_modules/a'),
    });
  });

  describe('the license file it keeps', () => {
    const files = {
      'LICENSE-APACHE': 'Apache License\nVersion 2.0',
      'LICENSE-MIT': 'Permission is hereby granted, free of charge',
      'LICENSE-BSD': 'Redistribution and use in source and binary forms',
    };

    let count = 0;

    /** The text kept of a package that carries `carried` and says it's under `license`. */
    function kept(license: string, carried: Record<string, string> = files): string | undefined {
      const folder = `node_modules/p${count++}`;
      put({
        [`${folder}/package.json`]: manifest({ name: 'p', version: '1.0.0', license }),
        [`${folder}/index.js`]: '',
        ...Object.fromEntries(
          Object.entries(carried).map(([name, text]) => [`${folder}/${name}`, text]),
        ),
      });
      return packageReader()(join(root, `${folder}/index.js`))?.text;
    }

    it('is that of the license an OR is taken under, the first of those allowed, whatever the order of the files by name', () => {
      expect(kept('MIT OR Apache-2.0')).toBe('Permission is hereby granted, free of charge');
      expect(kept('(Apache-2.0 OR MIT)')).toBe('Apache License\nVersion 2.0');
      expect(kept('GPL-3.0-only OR BSD-3-Clause')).toBe(
        'Redistribution and use in source and binary forms',
      );
    });

    it('is that of each license an AND is taken under', () => {
      expect(kept('MIT AND Apache-2.0')).toBe(
        'Apache License\nVersion 2.0\n\nPermission is hereby granted, free of charge',
      );
    });

    it('is found by what a file says when its name does not say, and is the only file there is when there is one', () => {
      const named = {
        'LICENSE.one': 'Apache License 2.0',
        'LICENSE.two': 'Permission is hereby granted, free of charge',
      };
      expect(kept('MIT OR Apache-2.0', named)).toBe('Permission is hereby granted, free of charge');
      expect(kept('Apache-2.0 OR MIT', named)).toBe('Apache License 2.0');
      expect(kept('MIT', { LICENSE: 'whatever it says' })).toBe('whatever it says');
    });

    it('is the first file by name when no file is the one', () => {
      expect(kept('ISC', { 'LICENSE-A': 'a', 'LICENSE-B': 'b' })).toBe('a');
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
      dir: join(root, 'node_modules/none'),
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

/** A bundled package, with the files and nested licenses it has none of unless said. */
function pack(fields: Pick<Bundled, 'name' | 'version'> & Partial<Bundled>): Bundled {
  return { dir: '/x', files: [], nested: [], ...fields };
}

describe('merged', () => {
  it('lists each package and version once, in order, with the files and nested licenses of every copy', () => {
    const a1 = pack({ name: 'a', version: '1.0.0', files: ['x.js'] });
    const a2 = pack({ name: 'a', version: '2.0.0' });
    const b = pack({ name: 'b', version: '1.0.0' });
    const nested = { path: 'lib/LICENSE', text: 'L' };
    expect(
      merged([
        b,
        a2,
        a1,
        { ...a1, files: ['y.js', 'x.js'], nested: [nested] },
        { ...b, nested: [nested] },
      ]),
    ).toEqual([
      { ...a1, files: ['x.js', 'y.js'], nested: [nested] },
      a2,
      { ...b, nested: [nested] },
    ]);
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
      // Each build starts as the build does, with whichever of these hooks the plugin has.
      for (const hook of [made.buildStart, made.renderStart]) {
        if (typeof hook === 'function') await Reflect.apply(hook, {}, [{}]);
      }
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
      {
        name: 'a',
        version: '1.0.0',
        license: 'MIT',
        text: undefined,
        notice: undefined,
        dir: join(root, 'node_modules/a'),
        files: ['index.js'],
        nested: [],
      },
      {
        name: 'f',
        version: '2.0.0',
        license: 'OFL-1.1',
        text: undefined,
        notice: undefined,
        dir: join(root, 'node_modules/f'),
        files: ['files/f.woff2'],
        nested: [],
      },
    ]);
  });

  it("lists the files of a package that a build has, and the licenses in the folders they're in below the package's root", () => {
    put({
      'node_modules/a/LICENSE': 'A',
      'node_modules/a/lib/NOTICE.txt': 'its own notice',
      'node_modules/a/lib/deep/LICENSE.md': 'DEEP',
      'node_modules/a/lib/deep/more/x.js': '',
      'node_modules/a/lib/other/COPYING': 'A',
      'node_modules/a/lib/other/y.js': '',
      'node_modules/a/lib/plain/z.js': '',
    });
    const found = collector(() => root);
    found.add(chunk('node_modules/a/lib/deep/more/x.js'));
    found.add(chunk('node_modules/a/lib/other/y.js'));
    found.add(chunk('node_modules/a/lib/plain/z.js'));
    const [listed] = found.list();
    expect(listed?.files).toEqual(['lib/deep/more/x.js', 'lib/other/y.js', 'lib/plain/z.js']);
    // The license beside y.js is the package's own, as its text is.
    expect(listed?.nested).toEqual([
      { path: 'lib/NOTICE.txt', text: 'its own notice' },
      { path: 'lib/deep/LICENSE.md', text: 'DEEP' },
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
      {
        name: 'a',
        version: '1.0.0',
        license: 'MIT',
        dir: join(root, 'node_modules/a'),
        files: ['index.js'],
        nested: [],
      },
      {
        name: 'f',
        version: '2.0.0',
        license: 'OFL-1.1',
        dir: join(root, 'node_modules/f'),
        files: ['index.js'],
        nested: [],
      },
    ]);
  });

  it('keeps what every build held, though each resolves its configuration again and the builds nest', async () => {
    const { emitFile, resolve, generate } = hooks();
    // The plugin is one instance for the root build and each build it nests, which each configure it.
    resolve(root);
    resolve(root);
    await generate([join(root, 'node_modules/f/index.js')], false);
    resolve(root);
    await generate([], false);
    resolve(root);
    await generate([join(root, 'node_modules/a/index.js')], true);
    const [file] = emitFile.mock.calls[0] ?? [];
    const listed: unknown = JSON.parse(file?.source ?? 'null');
    expect(
      Array.isArray(listed) ? listed.map((each: { name: string }) => each.name) : listed,
    ).toEqual(['a', 'f']);
  });

  it('does not write while a build nested in the root build is writing nothing, however many it has', async () => {
    const { emitFile, generate } = hooks();
    await generate([join(root, 'node_modules/f/index.js')], false);
    await generate([join(root, 'node_modules/a/index.js')], false);
    expect(emitFile).not.toHaveBeenCalled();
  });
});
