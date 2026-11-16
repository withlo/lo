/**
 * PHP: Intelephense, free tier. Its code is closed, under its own license (`LICENSE.txt` in its
 * package): a person may use it on their own devices, paired with an editor that speaks the
 * protocol, and its paid features need a key. Lo downloads it from npm, where its README says to
 * install it from, on the reader's machine, runs it as a program of its own, and names its license
 * wherever it says what the server is. It's one file, with everything it uses built in but Node's
 * own modules.
 *
 * - No license key: Lo gives it none, and it looks for one only in the server's own `HOME`, where
 *   its storage is too: `~/.config/intelephense`, its default where no `XDG_CONFIG_HOME` is set,
 *   and none is, and `~/intelephense`. Its paid features, inlay hints among them, refuse.
 * - No telemetry, which is off unless a client turns it on, and no network: without a key it sends
 *   nothing.
 * - Its settings are Lo's: with `workspace/configuration` offered, it never reads
 *   `intelephense.config.json` from the checkout. It runs no PHP and no other program.
 */

import { heapCap, type NodeServer } from './node.ts';

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
};
