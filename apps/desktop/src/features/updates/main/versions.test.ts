import { expect, it } from 'vitest';

import { compareVersions, isNewer } from './versions.ts';

it('orders versions as SemVer does', () => {
  // SemVer's own example, oldest first.
  const ordered = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
    '1.1.0',
    '2.0.0',
  ];
  for (const [at, older] of ordered.entries()) {
    for (const newer of ordered.slice(at + 1)) {
      expect(compareVersions(older, newer)).toBeLessThan(0);
      expect(compareVersions(newer, older)).toBeGreaterThan(0);
    }
    expect(compareVersions(older, older)).toBe(0);
  }
});

it('compares numbers by value, however long', () => {
  expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
  expect(compareVersions('0.1.0-rc.10', '0.1.0-rc.9')).toBeGreaterThan(0);
  expect(compareVersions('99999999999999999999.0.0', '99999999999999999998.0.0')).toBeGreaterThan(
    0,
  );
});

it('takes a newer version only, and only one Lo is released as', () => {
  expect(isNewer('0.2.0', '0.1.0')).toBe(true);
  expect(isNewer('0.2.0-rc.1', '0.1.0')).toBe(true);
  expect(isNewer('0.1.0', '0.1.0')).toBe(false);
  expect(isNewer('0.0.9', '0.1.0')).toBe(false);
  expect(isNewer('0.1.0-rc.2', '0.1.0')).toBe(false);
  expect(isNewer('v0.2.0', '0.1.0')).toBe(false);
  expect(isNewer('0.2.0+build', '0.1.0')).toBe(false);
});
