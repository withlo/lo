/**
 * PHP: Intelephense, free tier. Its code is closed, under its own license (`LICENSE.txt` in its
 * package, and its EULA page): a person may use it on their own devices, paired with an editor
 * that speaks the protocol, and its premium features need a key. Lo downloads it from npm, where
 * its README says to install it from, on the reader's machine, runs it as a program of its own, and
 * names its license wherever it says what the server is. It's one file, with everything it uses
 * built in but Node's own modules.
 *
 * - The reader accepts its license before Lo downloads it, once for each major version, since its
 *   license binds whoever installs it.
 * - Its messages reach the reader as it sent them, which its license asks: none is hidden or
 *   changed.
 * - No premium feature is ever asked for: Lo never sends it the requests its license names as
 *   premium, inlay hints among them, and doesn't offer them in its capabilities.
 * - No license key: Lo gives it none, and it looks for one only in the server's own `HOME`, where
 *   its storage is too: `~/.config/intelephense`, its default where no `XDG_CONFIG_HOME` is set,
 *   and none is, and `~/intelephense`.
 * - No telemetry, which is off unless a client turns it on, and no network: without a key it sends
 *   nothing.
 * - Its settings are Lo's: with `workspace/configuration` offered, it never reads
 *   `intelephense.config.json` from the checkout. It runs no PHP and no other program.
 */

import { heapCap, type NodeServer } from './node.ts';

/**
 * The requests for the features its license keeps for those with a key: rename, code folding,
 * implementations, type definitions, declarations, smart select, code actions, code lenses, type
 * hierarchies, inlay hints and document links.
 */
export const PREMIUM: readonly string[] = [
  'textDocument/rename',
  'textDocument/prepareRename',
  'textDocument/foldingRange',
  'textDocument/implementation',
  'textDocument/typeDefinition',
  'textDocument/declaration',
  'textDocument/selectionRange',
  'textDocument/codeAction',
  'codeAction/resolve',
  'textDocument/codeLens',
  'codeLens/resolve',
  'textDocument/prepareTypeHierarchy',
  'typeHierarchy/supertypes',
  'typeHierarchy/subtypes',
  'textDocument/inlayHint',
  'inlayHint/resolve',
  'textDocument/documentLink',
  'documentLink/resolve',
];

export const INTELEPHENSE: NodeServer = {
  id: 'intelephense',
  name: 'Intelephense',
  license: 'proprietary',
  node: [heapCap(3072)],
  args: ['--stdio'],
  settings: {
    intelephense: {
      telemetry: { enabled: false },
      // Lo shows no diagnostics and formats nothing.
      diagnostics: { enable: false },
      format: { enable: false },
    },
  },
  // Its free version has none: they're premium.
  hints: false,
  accept: { name: 'the Intelephense Licence', url: 'https://intelephense.com/eula' },
  shows: true,
  never: PREMIUM,
};
