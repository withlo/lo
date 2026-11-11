import { expect, test } from 'vitest';

import { errors, overview } from '../test/support.ts';
import { quote } from './findings.ts';
import { LIMITS, parseArtifact } from './index.ts';

test('at most 100 findings are kept, errors before warnings', () => {
  const warnings = Array.from({ length: 150 }, (_, n) => `[w${n}](nowhere${n})`).join('\n\n');
  const parsed = parseArtifact(overview(`${warnings}\n\n:::chart\n:::\n`));
  expect(parsed.findings).toHaveLength(LIMITS.findings);
  // The one error, which came last, is kept.
  expect(errors(parsed)).toEqual(['block-unknown']);
  const many = Array.from({ length: 150 }, () => ':::').join('\n');
  const flood = parseArtifact(overview(`${many}\n`));
  expect(flood.findings).toHaveLength(LIMITS.findings);
  // In the order of their lines.
  const lines = flood.findings.map(({ line }) => line ?? 0);
  expect(lines).toEqual(lines.toSorted((a, b) => a - b));
});

test('a message quotes the overview’s text without control or formatting characters', () => {
  expect(quote('plain')).toBe('plain');
  expect(quote('a\x1b[2Jb')).toBe('a\uFFFD[2Jb');
  expect(quote('evil\u202Egnp.exe')).toBe('evil\uFFFDgnp.exe');
  expect(quote('zero\u200Bwidth\u2028line\ud800')).toBe('zero\uFFFDwidth\uFFFDline\uFFFD');
  expect(quote('x'.repeat(1_000))).toBe(`${'x'.repeat(60)}…`);
  // Characters, not units: a pair is one.
  expect(quote('🧪'.repeat(61))).toBe(`${'🧪'.repeat(60)}…`);
  const parsed = parseArtifact(overview(':::\u202Ecode\x1b[31m\n:::\n'));
  expect(parsed.findings[0]?.message).toBe(":::\uFFFDcode\uFFFD[31m isn't a block Lo knows.");
});
