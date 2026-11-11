import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Setting } from './settings/contract.ts';

// Every setting every feature declares, found the way a feature's own folder holds them.
const modules = import.meta.glob<Record<string, unknown>>('./*/settings.ts', { eager: true });

/** Whether an export is a setting `defineSetting` made. */
function isSetting(value: unknown): value is Setting<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof value.key === 'string' &&
    'schema' in value &&
    'fallback' in value &&
    'accepts' in value &&
    typeof value.accepts === 'string'
  );
}

const settings = Object.values(modules)
  .flatMap((exports) => Object.values(exports))
  .filter(isSetting);

const docs = readFileSync(new URL('../../../../docs/settings.md', import.meta.url), 'utf8');

describe("every feature's settings", () => {
  it('are found', () => {
    expect(settings.map(({ key }) => key)).toContain('theme');
  });

  it('have a key each, so no two features declare the same one', () => {
    const keys = settings.map(({ key }) => key);
    expect(keys.filter((key, at) => keys.indexOf(key) !== at)).toEqual([]);
  });

  it.each(settings.map((setting) => [setting.key, setting] as const))(
    'are in docs/settings.md: %s',
    (key, setting) => {
      const row = docs.split('\n').find((line) => line.startsWith(`| \`${key}\` `));
      expect(row, `docs/settings.md has no row for ${key}.`).toBeDefined();
      // What it takes, in the words Lo reports a bad value in, and what it is without one.
      expect(row).toContain(setting.accepts);
      expect(row).toContain(`\`${JSON.stringify(setting.fallback)}\``);
    },
  );
});
