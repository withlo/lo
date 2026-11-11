/**
 * `THIRD_PARTY_NOTICES`, for the packages the checker's bundle holds: each one's name, version,
 * license and license text, read from where it's installed. A package whose license isn't one the
 * checker's MIT license can carry, or that ships no license text, fails the build.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

import type { Plugin } from 'vite';

/** The licenses a package bundled into the MIT-licensed checker may have. */
export const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD']);

/** The file the notices are written to, beside the bundle. */
export const NOTICES = 'THIRD_PARTY_NOTICES';

/** A package the bundle holds code from. */
export interface Bundled {
  name: string;
  version: string;
  license: string;
  /** Its license's text, from its own files. */
  text: string;
}

/**
 * The installed packages that `modules`, files the bundle was built from, belong to, in order of
 * name. Files outside any `node_modules` are the workspace's own. Throws for one that can't be
 * bundled.
 */
export function bundledPackages(modules: Iterable<string>): Bundled[] {
  const folders = new Set<string>();
  for (const module of modules) {
    const file = module.replace(/^\0+/, '').split('?')[0]!;
    const at = file.lastIndexOf(`${sep}node_modules${sep}`);
    if (at === -1) continue;
    const parts = file.slice(at + `${sep}node_modules${sep}`.length).split(sep);
    const name = parts[0]?.startsWith('@') ? parts.slice(0, 2).join(sep) : parts[0];
    if (name) folders.add(join(file.slice(0, at), 'node_modules', name));
  }
  return [...folders]
    .map(packageAt)
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The package installed in `folder`. */
export function packageAt(folder: string): Bundled {
  const manifest: unknown = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  const { name, version, license } =
    typeof manifest === 'object' && manifest !== null
      ? {
          name: field(manifest, 'name'),
          version: field(manifest, 'version'),
          license: field(manifest, 'license'),
        }
      : { name: undefined, version: undefined, license: undefined };
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new Error(`${folder} has no package name or version.`);
  }
  if (typeof license !== 'string' || !ALLOWED.has(license)) {
    throw new Error(
      `${name} is licensed ${JSON.stringify(license)}, which the MIT-licensed checker can't bundle. It bundles only ${[...ALLOWED].join(', ')}.`,
    );
  }
  const files = readdirSync(folder).filter((file) =>
    /^(?:licen[cs]e|copying)(?:[.-]|$)/i.test(file),
  );
  if (files.length === 0) throw new Error(`${name} ships no license text to give with it.`);
  const text = files
    .toSorted()
    .map((file) => readFileSync(join(folder, file), 'utf8').trim())
    .join('\n\n');
  return { name, version, license, text };
}

/** `object`'s field `key`, if it has one. */
function field(object: object, key: string): unknown {
  return Object.hasOwn(object, key)
    ? Object.getOwnPropertyDescriptor(object, key)?.value
    : undefined;
}

/** The notices for `packages`. */
export function notices(packages: readonly Bundled[]): string {
  const head = [
    'The checker bundles code from these packages, each under its own license, given in full.',
    '',
  ];
  const each = packages.map(({ name, version, license, text }) =>
    ['-'.repeat(72), `${name} ${version} (${license})`, '-'.repeat(72), '', text, ''].join('\n'),
  );
  return `${[...head, ...each].join('\n')}\n`;
}

/** A Vite plugin that writes the notices for what the bundle holds, beside it. */
export function thirdPartyNotices(): Plugin {
  return {
    name: 'lo-third-party-notices',
    generateBundle(_options, bundle) {
      const modules: string[] = [];
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') modules.push(...chunk.moduleIds);
      }
      // Fail on a file that's gone missing, rather than leave a package out.
      for (const module of modules) {
        const file = module.split('?')[0]!;
        if (file.startsWith(sep) && !existsSync(file)) throw new Error(`${file} isn't there.`);
      }
      this.emitFile({
        type: 'asset',
        fileName: NOTICES,
        source: notices(bundledPackages(modules)),
      });
    },
  };
}
