// "Overview note", which has no key: offered in the diff alone, which draws the overview's markers,
// on a line with one, and listed on that line's menu only.

import {
  commandsOf,
  menuSections,
  paletteItems,
  Registry,
  type LineTarget,
  type Target,
} from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import keys from './keys.ts';

/** A line, by its number in file `a`. */
const line = (number: number): LineTarget => ({
  kind: 'line',
  at: { file: 'a', side: 'new', line: number },
});

/** Whether `target` is line 4, the one line with a note. */
const noted = (target: Target) =>
  target.kind === 'line' && 'line' in target.at && target.at.line === 4;

/** The diff's commands, with a note on line 4 alone, as the diff's own handler says. */
const registry = new Registry({
  system: 'mac',
  commands: commandsOf(keys).map((command) =>
    command.name === 'overviewNote'
      ? {
          ...command,
          handler: {
            run() {},
            enabled: (target: Target) => noted(target) || 'There’s no overview note on this line.',
            listed: noted,
          },
        }
      : command,
  ),
});

/** Whether the palette offers "Overview note" in `scope`, on `target`. */
const offered = (scope: string, target: LineTarget) =>
  paletteItems(registry, scope, target).some((item) => item.id === 'diff.overviewNote');

describe('Overview note', () => {
  it('is in the palette in the diff alone, on a line with a note', () => {
    expect(offered('diff', line(4))).toBe(true);
    expect(offered('diff', line(5))).toBe(false);
    expect(
      ['file', 'tree', 'window', 'overview'].filter((scope) => offered(scope, line(4))),
    ).toEqual([]);
  });

  it('says why it can’t run on a line with no note, and is on that line’s menu only', () => {
    expect(registry.enabled('diff.overviewNote', line(5))).toBe(
      'There’s no overview note on this line.',
    );
    const menu = (target: LineTarget) =>
      menuSections(registry, target)
        .flat()
        .map((item) => item.label);
    expect(menu(line(4))).toContain('Overview note');
    expect(menu(line(5))).not.toContain('Overview note');
  });
});
