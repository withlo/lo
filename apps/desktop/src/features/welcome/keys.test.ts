import {
  Bindings,
  commandsOf,
  declaredBindings,
  eventStroke,
  match,
  type Focus,
  type KeyEventLike,
} from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import keys from './keys.ts';

const commands = commandsOf(keys);
const bindings = new Bindings('linux', declaredBindings(commands, 'linux'));

/** What a keydown runs where `focus` is. */
function runs(event: Partial<KeyEventLike>, focus: Focus): string | undefined {
  const stroke = eventStroke(
    { key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...event },
    { system: 'linux' },
  );
  if (!stroke) return undefined;
  const { outcome } = match(
    bindings,
    undefined,
    { stroke, repeat: false, composing: false, time: 0 },
    focus,
  );
  return outcome.kind === 'run' ? outcome.command.id : undefined;
}

const enter = { key: 'Enter', code: 'Enter' };

describe('the welcome screen’s keys', () => {
  it('⏎ signs in on the screen, in its link field too, where the command forwards it', () => {
    expect(runs(enter, { scope: 'welcome', text: false })).toBe('welcome.signIn');
    expect(runs(enter, { scope: 'welcome', text: true })).toBe('welcome.signIn');
  });

  it('takes no key anywhere else, nor a letter typed in its field', () => {
    for (const scope of ['window', 'recent', 'settings', 'dialog', 'tree']) {
      expect(runs(enter, { scope, text: false })).toBeUndefined();
    }
    expect(runs({ key: 'j', code: 'KeyJ' }, { scope: 'welcome', text: true })).toBeUndefined();
  });

  it('leaves Tab to the browser, which walks the screen’s controls', () => {
    expect(runs({ key: 'Tab', code: 'Tab' }, { scope: 'welcome', text: false })).toBeUndefined();
  });

  it('names its scope', () => {
    expect(keys.scopes).toEqual(['welcome']);
  });
});
