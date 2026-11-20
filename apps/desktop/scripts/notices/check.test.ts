import { describe, expect, it } from 'vitest';

import { ALLOWED, accepted, allowed, licenseProblems } from './check.ts';

describe('allowed', () => {
  it('takes every license on the list', () => {
    expect(ALLOWED.filter((id) => !allowed(id))).toEqual([]);
  });

  it('takes an expression the allowed licenses satisfy, in any case', () => {
    const refused = [
      '(MIT OR Apache-2.0)',
      'MIT AND BSD-3-Clause',
      'mit',
      'MIT or Apache-2.0',
      // The package may be taken under MIT.
      'MIT OR GPL-3.0-only',
      '(GPL-2.0-only OR ISC) AND (MIT OR GPL-3.0-only)',
      '((MIT))',
    ].filter((expression) => !allowed(expression));
    expect(refused).toEqual([]);
  });

  it('refuses every other license and every other expression', () => {
    const taken = [
      'GPL-3.0-only',
      'AGPL-3.0-or-later',
      'LGPL-2.1-only',
      'CC-BY-NC-4.0',
      'BUSL-1.1',
      'UNLICENSED',
      'SEE LICENSE IN LICENSE.md',
      // Only one of the two is allowed, and the package must be under both.
      'MIT AND GPL-3.0-only',
      // An exception changes the license.
      'Apache-2.0 WITH LLVM-exception',
      'MIT+',
      'MIT MIT',
      '',
      '(MIT',
      'MIT)',
      'MIT OR',
      'OR MIT',
      'MIT AND',
      '()',
    ].filter((expression) => allowed(expression));
    expect(taken).toEqual([]);
  });
});

describe('accepted', () => {
  it('says which license a package is taken under, the first of an OR that is allowed', () => {
    expect(accepted('MIT')).toEqual({ ok: true, ids: ['MIT'] });
    expect(accepted('(apache-2.0 OR MIT)')).toEqual({ ok: true, ids: ['Apache-2.0'] });
    expect(accepted('GPL-3.0-only OR ISC OR MIT')).toEqual({ ok: true, ids: ['ISC'] });
    expect(accepted('(MIT OR Apache-2.0) AND BSD-3-Clause')).toEqual({
      ok: true,
      ids: ['MIT', 'BSD-3-Clause'],
    });
  });

  it('names none when the expression is not satisfied', () => {
    expect(accepted('MIT AND GPL-3.0-only')).toMatchObject({ ok: false });
    expect(accepted('Apache-2.0 WITH LLVM-exception')).toEqual({ ok: false, ids: [] });
    expect(accepted('(MIT')).toEqual({ ok: false, ids: [] });
  });
});

const text = 'MIT License\n\nCopyright (c) someone';

describe('licenseProblems', () => {
  it('finds nothing wrong with packages that have an allowed license and its text', () => {
    expect(
      licenseProblems([
        { name: 'zod', version: '4.6.7', license: 'MIT', text },
        { name: 'tar', version: '7.5.22', license: 'BlueOak-1.0.0', text },
      ]),
    ).toEqual([]);
  });

  it('names each package that declares no license, one Lo can read, or one it carries no notice for', () => {
    expect(
      licenseProblems([
        { name: 'a', version: '1.0.0', text },
        { name: 'b', version: '2.0.0', license: '', text },
        { name: 'c', version: '3.0.0', license: 'GPL-3.0-only', text },
        { name: 'd', version: '4.0.0', license: 'MIT' },
        { name: 'e', version: '5.0.0', license: 'MIT', text: '' },
        { name: 'ok', version: '6.0.0', license: 'ISC', text },
      ]),
    ).toEqual([
      expect.stringMatching(/^a@1\.0\.0 declares no license/),
      expect.stringMatching(/^b@2\.0\.0 declares no license/),
      expect.stringMatching(/^c@3\.0\.0 is under GPL-3\.0-only, which isn't a license Lo carries/),
      expect.stringMatching(/^d@4\.0\.0 has no license file/),
      expect.stringMatching(/^e@5\.0\.0 has no license file/),
    ]);
    // A package with none may be one UNLICENSED can write a notice for.
    expect(licenseProblems([{ name: 'd', version: '4.0.0', license: 'MIT' }])[0]).toContain(
      'UNLICENSED in scripts/notices/inlined.ts',
    );
  });
});
