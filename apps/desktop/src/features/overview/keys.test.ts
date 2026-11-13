// What the overview's keys run in its view: the keys that scroll it, each to the command that does,
// so the window needs no browser to know `PageUp` pages up.

import {
  Bindings,
  commandsOf,
  declaredBindings,
  match,
  parseKeys,
  systemStrokes,
  type Focus,
  type System,
} from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import keys from './keys.ts';

const commands = commandsOf(keys);

/** What `key`, one or two strokes, runs where `focus` is, on `system`. */
function runs(key: string, focus: Focus, system: System): string | undefined {
  const bindings = new Bindings(system, declaredBindings(commands, system));
  let pending: Parameters<typeof match>[1];
  let outcome: ReturnType<typeof match>['outcome'] | undefined;
  for (const stroke of systemStrokes(parseKeys(key), system)) {
    const matched = match(
      bindings,
      pending,
      { stroke, repeat: false, composing: false, time: 0 },
      focus,
    );
    pending = matched.pending;
    outcome = matched.outcome;
  }
  return outcome?.kind === 'run' ? outcome.command.id : undefined;
}

const inOverview: Focus = { scope: 'overview', text: false };

describe('the overview’s scroll keys', () => {
  it('each run the command that scrolls that way, on both systems', () => {
    const scrolls: [string, string][] = [
      ['j', 'overview.scrollDown'],
      ['down', 'overview.scrollDown'],
      ['k', 'overview.scrollUp'],
      ['up', 'overview.scrollUp'],
      ['g g', 'overview.top'],
      ['home', 'overview.top'],
      ['G', 'overview.bottom'],
      ['end', 'overview.bottom'],
      ['pagedown', 'overview.pageDown'],
      ['pageup', 'overview.pageUp'],
    ];
    for (const system of ['mac', 'linux'] as const) {
      for (const [key, command] of scrolls) {
        expect(runs(key, inOverview, system), `${key} on ${system}`).toBe(command);
      }
    }
  });
});
