/**
 * TypeScript and JavaScript: vtsls, which runs VS Code's TypeScript support as a language server,
 * with the TypeScript it depends on, pinned with it in the manifest. vtsls starts TypeScript's
 * server, `tsserver`, as a child of its own, on the same Node.
 *
 * Nothing in the checkout brings code to run:
 *
 * - its own TypeScript, never the workspace's: no `typescript.tsdk`, and `vtsls.autoUseWorkspaceTsdk`
 *   off, so a `node_modules/typescript` in the checkout is never loaded;
 * - no plugin from the checkout: no plugin paths, no global plugins and no local plugin loads, so a
 *   plugin a `tsconfig.json` names is looked for by its package's name alone, never by a path, from
 *   the `node_modules` beside Lo's TypeScript, and, as Node finds packages, from each `node_modules`
 *   above Lo's install, such as `~/node_modules`: never from the checkout's own. A checkout can so
 *   load a package the user already has in one of those folders, though it can't add one, and
 *   neither vtsls nor `tsserver` has a way to turn a `tsconfig.json`'s plugins off. Which folders
 *   those are follows from where Lo installs servers (`test/plugins.test.ts`);
 * - no automatic type acquisition, so `tsserver` runs no npm and fetches nothing, whatever a
 *   `package.json` or `.npmrc` says;
 * - `tsserver` on vtsls's own Node: no `typescript.tsserver.nodePath`, and no TypeScript written in
 *   Go (`typescript.experimental.useTsgo`), which would run another program.
 *
 * vtsls reads only what Lo answers to `workspace/configuration`, never a `.vscode/settings.json`.
 */

import { heapCap, type NodeServer } from './node.ts';

/** The cap on `tsserver`'s heap, in megabytes: VS Code's, and under Lo's 4 GB for the group. */
const TSSERVER_HEAP = 3072;

/** The inlay hints `gh` shows: types, for TypeScript and JavaScript alike. */
const HINTS = {
  parameterTypes: { enabled: true },
  variableTypes: { enabled: true, suppressWhenTypeMatchesName: true },
  propertyDeclarationTypes: { enabled: true },
  functionLikeReturnTypes: { enabled: true },
};

export const VTSLS: NodeServer = {
  id: 'vtsls',
  name: 'vtsls',
  license: 'MIT',
  // vtsls itself holds little: the project is `tsserver`'s.
  node: [heapCap(512)],
  args: ['--stdio'],
  settings: {
    typescript: {
      tsserver: {
        pluginPaths: [],
        maxTsServerMemory: TSSERVER_HEAP,
        // One `tsserver`, not a second for syntax alone: Lo asks nothing a syntax server answers.
        useSyntaxServer: 'never',
        log: 'off',
      },
      disableAutomaticTypeAcquisition: true,
      check: { npmIsInstalled: false },
      experimental: { useTsgo: false },
      inlayHints: { ...HINTS, enumMemberValues: { enabled: true } },
    },
    javascript: { inlayHints: HINTS },
    vtsls: {
      autoUseWorkspaceTsdk: false,
      tsserver: { globalPlugins: [] },
    },
  },
  hints: true,
};
