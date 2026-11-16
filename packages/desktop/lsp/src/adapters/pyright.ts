/**
 * Python: Pyright, Microsoft's type checker, as a language server. It's one package with nothing
 * to depend on, and it carries the standard library's stubs (typeshed) itself.
 *
 * Pyright runs a Python interpreter to learn where its packages are installed: the one its
 * `python.pythonPath` setting names, or else the first `python3` or `python` on its `PATH`. Lo has
 * no Python of its own to give it, and gives it none of the machine's: its interpreter is
 * `/dev/null`, a device and not a program, which fails to run, so Pyright runs nothing and answers
 * from the checkout and its own stubs. No file of the checkout can name another:
 *
 * - `pyrightconfig.json` and `pyproject.toml` can name a virtual environment, whose packages
 *   Pyright reads, but never an interpreter, so that environment's `python` never runs;
 * - `.python-version`, which picks a version manager's Python, matters only to a `python` found on
 *   `PATH`, and Pyright never looks for one;
 * - a `.vscode/settings.json` isn't read: Pyright's settings are what Lo answers to
 *   `workspace/configuration`.
 *
 * Pyright uses no network. Without a client's cancellation folder it runs no background workers,
 * so it's one process.
 */

import { heapCap, type NodeServer } from './node.ts';

/** The interpreter Pyright is given: none it can run. */
export const NO_PYTHON = '/dev/null';

export const PYRIGHT: NodeServer = {
  id: 'pyright',
  name: 'Pyright',
  license: 'MIT',
  // Pyright empties its caches as its heap nears Node's limit, which this keeps under Lo's cap.
  node: [heapCap(3072)],
  args: ['--stdio'],
  // Its analysis keeps its defaults: imports looked for in `src` too, and only open files checked.
  settings: { python: { pythonPath: NO_PYTHON } },
  // It answers no `textDocument/inlayHint`: Pylance, its closed sibling, has them.
  hints: false,
};
