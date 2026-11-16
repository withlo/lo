/**
 * TypeScript and JavaScript: vtsls, which runs VS Code's TypeScript support as a language server,
 * with the TypeScript it depends on, pinned with it in the manifest. vtsls starts TypeScript's
 * server, `tsserver`, as a child of its own, on the same Node.
 *
 * Nothing in the checkout chooses what runs:
 *
 * - its own TypeScript, never the workspace's: no `typescript.tsdk`, and `vtsls.autoUseWorkspaceTsdk`
 *   off, so a `node_modules/typescript` in the checkout is never loaded;
 * - no plugins beyond those `tsserver` finds beside itself, in Lo's install: no plugin paths and
 *   no global plugins, so a plugin a `tsconfig.json` names is looked for there, and never in the
 *   checkout's `node_modules`;
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
};
