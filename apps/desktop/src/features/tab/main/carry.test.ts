// The key `tab.open` replaced, carried over once: a saved `diff` becomes `tab.open`'s while the
// file has no `tab.open`, the old key is then `null` so it's never carried again, and one that
// can't be written is left to try at the next start.

import { describe, expect, it } from 'vitest';

import type { Setting } from '../../settings/contract.ts';
import { before, open } from '../settings.ts';
import { carryOver } from './carry.ts';

/** A settings file holding `values`, which `update` changes as main's does; or one that refuses. */
function fileOf(values: Record<string, unknown>, refuses = false) {
  return {
    values,
    update<T>(setting: Setting<T>, change: (value: T, inFile: boolean) => T): Promise<void> {
      if (refuses) return Promise.reject(new Error('The file can’t be written.'));
      const inFile = Object.hasOwn(values, setting.key);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test's own values.
      const now = (inFile ? values[setting.key] : setting.fallback) as T;
      values[setting.key] = change(now, inFile);
      return Promise.resolve();
    },
  };
}

describe('the key tab.open replaced', () => {
  it('carries a saved diff over to tab.open, then is null', async () => {
    const file = fileOf({ [before.key]: 'diff' });
    await carryOver(file, 'diff', () => undefined);
    expect(file.values).toEqual({ [before.key]: null, [open.key]: 'diff' });
  });

  it('leaves a tab.open already chosen as it is', async () => {
    const file = fileOf({ [before.key]: 'diff', [open.key]: 'timeline' });
    await carryOver(file, 'diff', () => undefined);
    expect(file.values).toEqual({ [before.key]: null, [open.key]: 'timeline' });
  });

  it('leaves a tab.open of overview, its default, as it is, since the file has it', async () => {
    const file = fileOf({ [before.key]: 'diff', [open.key]: 'overview' });
    await carryOver(file, 'diff', () => undefined);
    expect(file.values).toEqual({ [before.key]: null, [open.key]: 'overview' });
  });

  it('carries nothing for the overview, which is tab.open’s default, and is null', async () => {
    const file = fileOf({ [before.key]: 'overview' });
    await carryOver(file, 'overview', () => undefined);
    expect(file.values).toEqual({ [before.key]: null });
  });

  it('stays as it is in a file that can’t be written, saying why, for the next start', async () => {
    const file = fileOf({ [before.key]: 'diff' }, true);
    const logged: string[] = [];
    await carryOver(file, 'diff', (line) => logged.push(line));
    expect(file.values).toEqual({ [before.key]: 'diff' });
    expect(logged).toEqual(['carrying overview.open over: The file can’t be written.']);
  });
});
