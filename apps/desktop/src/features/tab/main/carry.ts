// The key `tab.open` replaced, `overview.open`, carried over once: a `diff` saved there becomes
// `tab.open`'s, where that's still its default, and then the old key is `null`, so a later choice
// stands. One that can't be written is carried at the next start.

import type { SettingsStore } from '../../settings/service.ts';
import { before, open } from '../settings.ts';

/** Whether a carry is under way, so a second read of the file meanwhile starts none. */
let carrying = false;

/** Carries `value`, saved under the key `tab.open` replaced, over to it, saying why one failed. */
export async function carryOver(
  file: Pick<SettingsStore, 'update'>,
  value: 'overview' | 'diff',
  log: (line: string) => void,
): Promise<void> {
  if (carrying) return;
  carrying = true;
  try {
    if (value === 'diff') {
      await file.update(open, (now) => (now === open.fallback ? 'diff' : now));
    }
    await file.update(before, () => null);
  } catch (error) {
    log(`carrying overview.open over: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    carrying = false;
  }
}
