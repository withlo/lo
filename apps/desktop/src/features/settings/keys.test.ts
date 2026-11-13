// What Settings' keys run on its page: `j` and `k` go to the next and previous section, and nothing
// runs them outside Settings.

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

const inSettings: Focus = { scope: 'settings', text: false };
const inMiddle: Focus = { scope: 'window', text: false };

describe('Settings’ section keys', () => {
  it('j and k move a section on the page, on both systems', () => {
    for (const system of ['mac', 'linux'] as const) {
      expect(runs('j', inSettings, system), `j on ${system}`).toBe('settings.nextSection');
      expect(runs('k', inSettings, system), `k on ${system}`).toBe('settings.previousSection');
    }
  });

  it('run nothing elsewhere', () => {
    expect(runs('j', inMiddle, 'mac')).toBeUndefined();
    expect(runs('k', inMiddle, 'mac')).toBeUndefined();
  });
});
