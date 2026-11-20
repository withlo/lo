import { describe, expect, it } from 'vitest';

import type { Bundled } from './packages.ts';
import { renderNotices } from './render.ts';

/** A bundled package, with the files and nested licenses it has none of unless said. */
function pack(fields: Pick<Bundled, 'name' | 'version'> & Partial<Bundled>): Bundled {
  return { dir: '/node_modules/x', files: [], nested: [], ...fields };
}

const base = {
  copyright: 'Copyright © 2026 Someone',
  summary: 'Lo is free software.',
  gpl: 'THE GPL',
  apache: 'THE APACHE LICENSE',
  packages: [],
  kept: [],
};

describe('renderNotices', () => {
  it("starts with Lo's own license and ends with the Apache License, each package and each kept entry between", () => {
    const text = renderNotices({
      ...base,
      packages: [
        pack({ name: 'zod', version: '4.6.7', license: 'MIT', text: 'ZOD LICENSE' }),
        pack({
          name: 'thing',
          version: '1.0.0',
          license: 'Apache-2.0',
          text: 'THING LICENSE',
          notice: 'THING NOTICE',
        }),
      ],
      kept: [
        {
          repo: 'o/mit',
          at: 'abc',
          provides: 'a grammar',
          license: 'MIT',
          copyright: ['Copyright (c) 2020 Someone'],
        },
        {
          repo: 'o/apache',
          provides: 'queries',
          license: 'Apache-2.0',
          copyright: [],
          notice: 'KEPT NOTICE',
        },
        {
          repo: 'o/file',
          provides: 'a diff',
          license: 'MIT',
          copyright: [],
          licenseText: 'ITS OWN FILE',
        },
      ],
    });
    expect(text.startsWith('Lo\n==\n\nCopyright © 2026 Someone\n\nLo is free software.\n')).toBe(
      true,
    );
    expect(
      text.endsWith(
        'Apache License, version 2.0\n===========================\n\nTHE APACHE LICENSE\n',
      ),
    ).toBe(true);
    const order = [
      'THE GPL',
      'zod@4.6.7 (MIT)',
      'ZOD LICENSE',
      'thing@1.0.0 (Apache-2.0)',
      'THING LICENSE',
      'THING NOTICE',
      'https://github.com/o/mit at abc',
      'In Lo: a grammar.',
      'Copyright (c) 2020 Someone\n\nMIT License\n\nPermission is hereby granted',
      'https://github.com/o/apache\n',
      'whose text is at the end of this file.',
      'KEPT NOTICE',
      'ITS OWN FILE',
      'THE APACHE LICENSE',
    ];
    const at = order.map((part) => text.indexOf(part));
    expect(order.filter((_, index) => at[index] === -1)).toEqual([]);
    expect(at).toEqual(at.toSorted((a, b) => a - b));
    // An entry that has its own license file doesn't also get the standard text.
    expect(
      text.slice(text.indexOf('o/file'), text.indexOf('Apache License, version 2.0')),
    ).not.toContain('Permission is hereby granted');
  });

  it('names where Electron’s and Chromium’s licenses are, which electron-builder installs', () => {
    const text = renderNotices(base);
    expect(text).toContain('LICENSE.electron.txt');
    expect(text).toContain('LICENSES.chromium.html');
  });

  it('says a package has no license when it has none, rather than leaving the heading short', () => {
    expect(renderNotices({ ...base, packages: [pack({ name: 'x', version: '1.0.0' })] })).toContain(
      'x@1.0.0 (no license)',
    );
  });

  it('puts what a package holds of its own after its license: licenses in its folders, and copyright lines in its files, and says what it is built into', () => {
    const text = renderNotices({
      ...base,
      packages: [
        pack({
          name: 'outer',
          version: '1.0.0',
          license: 'MIT',
          text: 'OUTER LICENSE',
          nested: [{ path: 'lib/inner/LICENSE.md', text: 'INNER LICENSE' }],
          says: ['Copyright (c) Somebody Else', 'Copyright (c) Another'],
        }),
        pack({
          name: 'inner',
          version: '2.0.0',
          license: 'ISC',
          text: 'ISC LICENSE',
          in: 'outer@1.0.0',
        }),
      ],
    });
    const order = [
      'outer@1.0.0 (MIT)',
      'OUTER LICENSE',
      'Its lib/inner/LICENSE.md says:\n\nINNER LICENSE',
      'Its files also say:\n\nCopyright (c) Somebody Else\nCopyright (c) Another',
      'inner@2.0.0 (ISC)\n-----------------\nBuilt into outer@1.0.0.\n\nISC LICENSE',
    ];
    const at = order.map((part) => text.indexOf(part));
    expect(order.filter((_, index) => at[index] === -1)).toEqual([]);
    expect(at).toEqual(at.toSorted((a, b) => a - b));
  });
});
