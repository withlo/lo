/** Generated files: those the repository marks `linguist-generated`, and lockfiles. */

import { fileName, type ChangedFile } from './changed.ts';

/**
 * Why a file counts as generated: `attribute` when the repository's `.gitattributes` marks it
 * `linguist-generated`, `lockfile` when it's a package manager's lockfile ({@link isLockfile}).
 */
export type Generated = 'attribute' | 'lockfile';

/** Lockfile names, matched against a path's last component. */
const LOCKFILES: ReadonlySet<string> = new Set([
  // JavaScript: pnpm, npm, Yarn, Bun.
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  // Cargo, Go.
  'Cargo.lock',
  'go.sum',
  // Python: uv, Poetry.
  'uv.lock',
  'poetry.lock',
  // Ruby, PHP.
  'Gemfile.lock',
  'composer.lock',
  // Apple: CocoaPods, Swift Package Manager.
  'Podfile.lock',
  'Package.resolved',
  // Dart, Elixir, Nix, .NET (NuGet).
  'pubspec.lock',
  'mix.lock',
  'flake.lock',
  'packages.lock.json',
]);

/**
 * Whether `path` names a package manager's lockfile, in any directory.
 *
 * Matches the file name exactly, case included: `Cargo.lock` is a lockfile, `cargo.lock` isn't.
 */
export function isLockfile(path: string): boolean {
  return LOCKFILES.has(fileName(path));
}

/**
 * Why the file is generated, or nothing when it isn't.
 *
 * The `linguist-generated` attribute decides when `.gitattributes` sets or unsets it. Otherwise,
 * lockfiles are generated. So `Cargo.lock -linguist-generated` keeps `Cargo.lock` expanded, as
 * GitHub does.
 */
export function whyGenerated(file: ChangedFile): Generated | undefined {
  if (file.linguistGenerated !== undefined) return file.linguistGenerated ? 'attribute' : undefined;
  return isLockfile(file.path) ? 'lockfile' : undefined;
}
