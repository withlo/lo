// "Show overview note", which `⏎` runs on a line an overview note is over: offered in the diff alone,
// which draws the overview's marks, on a line with one, and listed on that line's menu only. And
// `gm`, a jump, which `⌃o` comes back from.

import {
  commandsOf,
  menuSections,
  paletteItems,
  Registry,
  type Entry,
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
            enabled: (target: Target) => noted(target) || 'No overview note on this line',
            listed: noted,
          },
        }
      : command,
  ),
});

/** Whether the palette offers "Show overview note" in `scope`, on `target`. */
const offered = (scope: string, target: LineTarget) =>
  paletteItems(registry, scope, target).some((item) => item.id === 'diff.overviewNote');

describe('Show overview note', () => {
  it('is in the palette in the diff alone, on a line with a note', () => {
    expect(offered('diff', line(4))).toBe(true);
    expect(offered('diff', line(5))).toBe(false);
    expect(
      ['file', 'tree', 'window', 'overview'].filter((scope) => offered(scope, line(4))),
    ).toEqual([]);
  });

  it('says why it can’t run on a line with no note, and is on that line’s menu only', () => {
    expect(registry.enabled('diff.overviewNote', line(5))).toBe('No overview note on this line');
    const menu = (target: LineTarget) =>
      menuSections(registry, target)
        .flat()
        .map((item) => item.label);
    expect(menu(line(4))).toContain('Show overview note');
    expect(menu(line(5))).not.toContain('Show overview note');
  });
});

describe('the overview’s notes’ keys', () => {
  it('step to the next and previous note, open what’s on the line, and show it in the overview', () => {
    const keysOf = (id: string) =>
      registry.keysOf(id).map((each) => each.map((stroke) => stroke.id).join(' '));
    expect(keysOf('diff.nextNote')).toEqual(['] o']);
    expect(keysOf('diff.previousNote')).toEqual(['[ o']);
    expect(keysOf('diff.overviewNote')).toEqual(['enter']);
    expect(keysOf('diff.showInOverview')).toEqual(['g o']);
  });
});

describe('Go to moved code', () => {
  it('is a jump: it records where the cursor was, which ⌃o goes back to', () => {
    const here: Entry = { view: 'diff', at: line(4) };
    const jumps = new Registry({
      system: 'mac',
      commands: commandsOf(keys).map((command) =>
        command.name === 'otherEnd' ? { ...command, handler: { run() {} } } : command,
      ),
      here: () => here,
    });
    const shown: Target[] = [];
    jumps.history.register('', 'diff', (at) => {
      shown.push(at);
      return true;
    });
    expect(jumps.run('diff.otherEnd', line(4))).toBe(true);
    expect(jumps.history.back({ view: 'diff', at: line(9) })).toEqual(here);
    expect(shown).toEqual([line(4)]);
  });
});
