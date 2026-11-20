import { describe, expect, it } from 'vitest';

import { renderNotices } from './render.ts';

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
        { name: 'zod', version: '4.6.7', license: 'MIT', text: 'ZOD LICENSE' },
        {
          name: 'thing',
          version: '1.0.0',
          license: 'Apache-2.0',
          text: 'THING LICENSE',
          notice: 'THING NOTICE',
        },
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
          repo: 'o/gpl',
          provides: 'more queries',
          license: 'GPL-3.0-or-later',
          copyright: ['Copyright X'],
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
      'Licensed under the GNU General Public License, version 3 or later.',
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
    expect(renderNotices({ ...base, packages: [{ name: 'x', version: '1.0.0' }] })).toContain(
      'x@1.0.0 (no license)',
    );
  });
});
