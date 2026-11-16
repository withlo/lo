/**
 * PHP: php-lsp, a language server written in Rust. It's one program, which carries the stubs of
 * PHP's own functions and classes, so it needs no PHP.
 *
 * Nothing in the checkout chooses what it runs, or where it writes:
 *
 * - it runs no `php`: told no version, it would run the first `php` on its `PATH` to ask, and Lo
 *   tells it one;
 * - it runs no tools: PHPStan and PHPCS, which it can run on a save, are off, and Lo never saves.
 *   Lo asks for nothing that would run another program: formatting (`php-cs-fixer` or `phpcbf`)
 *   or a code lens's test command (`vendor/bin/phpunit`);
 * - its cache is a folder of its `HOME`, which Lo names (`cachePath`), never one in the checkout;
 * - it skips `vendor/` as it indexes: Lo installs no dependencies, so a checkout has one only if
 *   it commits it, and a class there is read only when something refers to it.
 *
 * What Lo tells it wins over the checkout's `.php-lsp.json` key by key, and that file can't set
 * `externalTools` or `cachePath` at all. What else it sets changes what php-lsp reads and reports,
 * never what runs: which paths it indexes or skips, and folders of stubs. Like every server Lo
 * runs, it has no sandbox: it reads what the user can, so those folders can lead it outside the
 * checkout, whose text a hover can show. Lo never opens a place outside the checkout an answer
 * names: it shows as outside the repository.
 */

import type { NativeServer } from './native.ts';

/** The PHP it reads code as: PHP's newest, which php-lsp also takes when nothing names one. */
export const PHP_VERSION = '8.5';

/** What php-lsp is told, the same in `initialize` and when it asks for its settings. */
const OPTIONS = {
  phpVersion: PHP_VERSION,
  indexVendor: false,
  externalTools: { phpstan: { enabled: false }, phpcs: { enabled: false } },
};

export const PHP_LSP: NativeServer = {
  id: 'php-lsp',
  name: 'php-lsp',
  license: 'MIT',
  // It speaks the protocol over its stdio, with no arguments.
  args: [],
  settings: { 'php-lsp': OPTIONS },
  initializationOptions: OPTIONS,
  cacheOption: 'cachePath',
  // Parameters' names at a call, and functions' return types.
  hints: true,
};
