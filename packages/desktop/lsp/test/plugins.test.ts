// Where `tsserver` looks for a plugin a checkout's `tsconfig.json` names, with vtsls's settings as
// Lo gives them: TypeScript's own project service, the one `tsserver` runs, in this process, with
// Lo's install of vtsls faked as folders and its TypeScript as the repository's, so nothing is
// downloaded. Each plugin planted here writes a marker when it's loaded: one in the checkout's
// `node_modules` never is, nor one named by a path, but a package already in a `node_modules` above
// Lo's install is, as Node finds packages, and neither vtsls nor `tsserver` can turn that off.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { expect, test } from 'vitest';

import { VTSLS } from '../src/index.ts';
import { sectionOf } from '../src/requests.ts';
import { tempFolder } from './support.ts';

/** A plugin package at `folder`, which writes `marker` when `tsserver` loads it. */
function plant(folder: string, marker: string): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'plugin', main: 'index.js' }));
  writeFileSync(
    join(folder, 'index.js'),
    `module.exports = () => {
  require('node:fs').writeFileSync(${JSON.stringify(marker)}, '');
  return { create: (info) => info.languageService };
};
`,
  );
}

/** A list setting of vtsls's, as Lo gives it. */
function listed(section: string): string[] {
  const value = sectionOf(VTSLS.settings, section);
  if (!Array.isArray(value) || !value.every((each) => typeof each === 'string')) {
    throw new Error(`${section} isn't a list of names`);
  }
  return value;
}

test('a tsconfig.json’s plugin loads only by its name, from beside Lo’s TypeScript or above it', () => {
  const home = tempFolder();
  // Lo's install of vtsls, under the home folder as its cache is, and where `tsserver` runs from.
  const install = join(home, 'cache', 'lo', 'servers', 'vtsls', '0.3.0', 'files');
  const tsserver = join(install, 'node_modules', 'typescript', 'lib', 'tsserver.js');
  mkdirSync(join(install, 'node_modules', 'typescript', 'lib'), { recursive: true });
  const checkout = join(home, 'checkouts', 'pull-1');
  const marker = (name: string) => join(home, `lo-ran-${name}`);
  // A package the user has above Lo's install, the checkout's own, and one above the checkout.
  plant(join(home, 'node_modules', 'ancestor-plugin'), marker('ancestor'));
  plant(join(checkout, 'node_modules', 'checkout-plugin'), marker('checkout'));
  plant(join(home, 'checkouts', 'node_modules', 'beside-plugin'), marker('beside'));
  writeFileSync(join(checkout, 'a.ts'), 'export const a = 1;\n');
  writeFileSync(
    join(checkout, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        plugins: [
          { name: 'checkout-plugin' },
          { name: 'beside-plugin' },
          { name: './node_modules/checkout-plugin' },
          { name: '../node_modules/beside-plugin' },
          { name: 'ancestor-plugin' },
        ],
      },
    }),
  );

  const said: string[] = [];
  const logger: ts.server.Logger = {
    close: () => undefined,
    hasLevel: () => true,
    loggingEnabled: () => true,
    perftrc: () => undefined,
    info: (line) => said.push(line),
    msg: (line) => said.push(line),
    startGroup: () => undefined,
    endGroup: () => undefined,
    getLogFileName: () => undefined,
  };
  const unwatched = { close: () => undefined };
  const host: ts.server.ServerHost = {
    ...ts.sys,
    getExecutingFilePath: () => tsserver,
    watchFile: () => unwatched,
    watchDirectory: () => unwatched,
    setTimeout,
    clearTimeout,
    setImmediate,
    clearImmediate,
  };
  const service = new ts.server.ProjectService({
    host,
    logger,
    cancellationToken: ts.server.nullCancellationToken,
    useSingleInferredProject: false,
    useInferredProjectPerProjectRoot: true,
    typingsInstaller: ts.server.nullTypingsInstaller,
    session: undefined,
    // As vtsls passes them from Lo's settings: none of either, and no local plugin loads.
    globalPlugins: listed('vtsls.tsserver.globalPlugins'),
    pluginProbeLocations: listed('typescript.tsserver.pluginPaths'),
    allowLocalPluginLoads: false,
  });
  service.openClientFile(join(checkout, 'a.ts'));

  // One named by a path is never looked for, and the rest only from beside Lo's TypeScript: the
  // folder three up from `tsserver.js`, Lo's `node_modules`, and, as Node finds packages, above it.
  expect(said.filter((line) => line.includes('only package name is allowed'))).toHaveLength(2);
  const loading = said.filter((line) => line.startsWith('Loading '));
  expect(loading.map((line) => line.split(' ')[1])).toEqual([
    'checkout-plugin',
    'beside-plugin',
    'ancestor-plugin',
  ]);
  for (const line of loading) {
    expect(line).toContain(
      `from ${tsserver}/../../.. (resolved to ${join(install, 'node_modules', 'node_modules')})`,
    );
  }
  // Nothing of the checkout's, or beside it, loads; a package above Lo's install does.
  expect(['checkout', 'beside', 'ancestor'].map((name) => existsSync(marker(name)))).toEqual([
    false,
    false,
    true,
  ]);
});
