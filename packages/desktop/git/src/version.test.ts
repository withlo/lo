import { expect, test } from 'vitest';

import {
  compareVersions,
  formatVersion,
  type GitVersion,
  MINIMUM_VERSION,
  parseVersion,
} from './version.ts';

function version(major: number, minor: number, patch: number): GitVersion {
  return { major, minor, patch };
}

test('parses versions', () => {
  const cases: [string, GitVersion][] = [
    ['git version 2.54.0 (Apple Git-157)\n', version(2, 54, 0)],
    ['git version 2.40.0', version(2, 40, 0)],
    ['git version 2.39.5 (Apple Git-154)', version(2, 39, 5)],
    ['git version 2.45.2.windows.1', version(2, 45, 2)],
    ['git version 2.40.0.rc1', version(2, 40, 0)],
    ['git version 2.40.0-rc1', version(2, 40, 0)],
    ['git version 2.41', version(2, 41, 0)],
    ['git version 3.0.0', version(3, 0, 0)],
  ];
  expect(cases.map(([output]) => [output, parseVersion(output)])).toEqual(cases);
  const notVersions = ['', 'git version', 'git version x.y', 'hub version 2.40.0', '2.40.0'];
  expect(notVersions.filter((output) => parseVersion(output) !== undefined)).toEqual([]);
});

test('needs git 2 41', () => {
  expect(MINIMUM_VERSION).toEqual(version(2, 41, 0));
  expect(compareVersions(version(2, 40, 1), MINIMUM_VERSION)).toBeLessThan(0);
  expect(compareVersions(version(2, 41, 0), MINIMUM_VERSION)).toBeGreaterThanOrEqual(0);
  expect(compareVersions(version(2, 100, 0), version(2, 40, 0))).toBeGreaterThan(0);
  expect(formatVersion(version(2, 40, 1))).toBe('2.40.1');
});
