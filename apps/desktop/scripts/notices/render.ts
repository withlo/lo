// The text of `licenses.txt`: Lo's own license, then the license of every package it bundles and of
// everything else it ships that isn't one, each in full.

import { MIT_TERMS, type KeptNotice } from './kept.ts';
import type { Bundled } from './packages.ts';

export interface Notices {
  /** Lo's copyright line. */
  readonly copyright: string;
  /** Lo's license in a sentence, which the About panel says too. */
  readonly summary: string;
  /** The GNU General Public License, version 3, in full. */
  readonly gpl: string;
  /** The Apache License, version 2.0, in full. */
  readonly apache: string;
  /** What the build bundles, which is every package in a bundle or copied into the output. */
  readonly packages: readonly Bundled[];
  /** What else Lo ships. */
  readonly kept: readonly KeptNotice[];
}

/** A heading, underlined. */
function heading(title: string, mark: string): string {
  return `${title}\n${mark.repeat(title.length)}`;
}

/** A kept entry's section: where it comes from, what Lo has of it, and its license. */
function keptSection(entry: KeptNotice): string {
  const at = entry.at === undefined ? '' : ` at ${entry.at}`;
  const lines = [
    heading(entry.repo, '-'),
    `https://github.com/${entry.repo}${at}`,
    `In Lo: ${entry.provides}.`,
    '',
  ];
  if (entry.licenseText !== undefined) return [...lines, entry.licenseText].join('\n');
  if (entry.copyright.length > 0) lines.push(...entry.copyright, '');
  switch (entry.license) {
    case 'MIT':
      lines.push('MIT License', '', MIT_TERMS);
      break;
    case 'Apache-2.0':
      lines.push(
        'Licensed under the Apache License, Version 2.0, whose text is at the end of this file.',
      );
      break;
    case 'GPL-3.0-or-later':
      lines.push(
        'Licensed under the GNU General Public License, version 3 or later. Lo uses it under',
        'version 3, whose text is at the start of this file.',
      );
      break;
    default:
      entry.license satisfies never;
      throw new Error(`There's no text for the license ${String(entry.license)}.`);
  }
  if (entry.notice !== undefined) lines.push('', 'Its NOTICE file says:', '', entry.notice);
  return lines.join('\n');
}

/**
 * A bundled package's section: its name, version and license, and the license's text, then what
 * else it carries of its own: its NOTICE, the licenses of code in its folders, and the copyright
 * lines in its files that its license doesn't hold.
 */
function packageSection(bundled: Bundled): string {
  const lines = [
    heading(`${bundled.name}@${bundled.version} (${bundled.license ?? 'no license'})`, '-'),
  ];
  if (bundled.in !== undefined) lines.push(`Built into ${bundled.in}.`, '');
  lines.push(bundled.text ?? '');
  if (bundled.notice !== undefined) lines.push('', 'Its NOTICE file says:', '', bundled.notice);
  for (const { path, text } of bundled.nested) lines.push('', `Its ${path} says:`, '', text);
  if (bundled.says !== undefined && bundled.says.length > 0) {
    lines.push('', 'Its files also say:', '', ...bundled.says);
  }
  return lines.join('\n');
}

/** The whole text of `licenses.txt`. */
export function renderNotices(notices: Notices): string {
  const sections = [
    [heading('Lo', '='), notices.copyright, notices.summary].join('\n\n'),
    [
      "Lo includes the software below, each part under its own license. Electron's license is in",
      "LICENSE.electron.txt and Chromium's, with the licenses of what it includes, is in",
      'LICENSES.chromium.html. Both are installed with Lo.',
    ].join('\n'),
    [heading('GNU General Public License, version 3', '='), notices.gpl].join('\n\n'),
    [heading('Packages bundled into Lo', '='), ...notices.packages.map(packageSection)].join(
      '\n\n',
    ),
    [heading('Other software and data in Lo', '='), ...notices.kept.map(keptSection)].join('\n\n'),
    [heading('Apache License, version 2.0', '='), notices.apache].join('\n\n'),
  ];
  return `${sections.join('\n\n\n')}\n`;
}
