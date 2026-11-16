/**
 * PHP: php-lsp, a language server written in Rust. It's one program, which carries the stubs of
 * PHP's own functions and classes, so it needs no PHP.
 *
 * Nothing in the checkout chooses what it runs, or where it writes:
 *
 * - it runs no `php`: told no version, it would run the first `php` on its `PATH` to ask, and the
 *   folder of Lo's git comes first there, which for a git from Homebrew is Homebrew's `bin`, where
 *   a `php` can be. So Lo tells it one ({@link PHP_VERSION});
 * - it runs no tools: PHPStan and PHPCS, which it can run on a save, are off, and Lo never saves.
 *   Lo asks for nothing that would run another program: formatting (`php-cs-fixer` or `phpcbf`)
 *   or a code lens's test command (`vendor/bin/phpunit`);
 * - its cache is where it keeps one by default, `$XDG_CACHE_HOME`, or else `.cache` in its `HOME`.
 *   Lo sets no `XDG_CACHE_HOME`, so that's `.cache/php-lsp` in the folder Lo keeps for it. There
 *   it keeps a folder for each version of itself and each checkout, caps each and all of them
 *   together, and drops the folders of checkouts that are gone. Lo names no `cachePath`, which
 *   php-lsp would take as the whole cache, with none of that.
 *
 * It skips `vendor/` as it indexes: Lo installs no dependencies, so a checkout has one only if it
 * commits it, and then it can hold far more code than the project, which would cost memory and
 * time and count against php-lsp's cap on the files it indexes. `gd`, `K` and `gh` still find a
 * class there when something refers to it, through Composer's autoload, and `gr` never looks there.
 *
 * What Lo tells it wins over the checkout's `.php-lsp.json` key by key, and that file can't set
 * `externalTools` or `cachePath` at all. What else it sets changes what php-lsp reads and reports,
 * never what runs: which paths it indexes or skips, and folders of stubs. Like every server Lo
 * runs, it has no sandbox: it reads what the user can, so those folders can lead it outside the
 * checkout, and so can the paths a `composer.json`'s autoload names, and a `composer.json` up to
 * seven folders above the checkout, which it climbs to when the checkout has none. It only reads
 * there, and a hover can show what it read. Lo never opens a place outside the checkout an answer
 * names: it shows as outside the repository.
 */

import type { NativeServer } from './native.ts';

/**
 * The PHP it reads code as: PHP's newest, which php-lsp also takes when nothing names one. Code for
 * an older PHP is read as this one too, so a function PHP 8 removed, such as `each` or
 * `create_function`, has no stub, and no hover.
 */
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
  // Parameters' names at a call, and functions' return types.
  hints: true,
};
