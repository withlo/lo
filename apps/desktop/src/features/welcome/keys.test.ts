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

describe('the welcome’s keys', () => {
  it('⏎ continues in the welcome, in its link field too, where the command forwards it', () => {
    expect(runs(enter, { scope: 'welcome', text: false })).toBe('welcome.continue');
    expect(runs(enter, { scope: 'welcome', text: true })).toBe('welcome.continue');
  });

  it('⇧⏎ goes back in the welcome, in its link field too, and not in a comment box', () => {
    const back = { key: 'Enter', code: 'Enter', shiftKey: true };
    expect(runs(back, { scope: 'welcome', text: false })).toBe('welcome.back');
    expect(runs(back, { scope: 'welcome', text: true })).toBe('welcome.back');
    expect(runs(back, { scope: 'box', text: true })).toBeUndefined();
  });

  it('takes no key anywhere else, nor a letter typed in its field', () => {
    for (const scope of ['window', 'recent', 'settings', 'dialog', 'tree']) {
      expect(runs(enter, { scope, text: false })).toBeUndefined();
    }
    expect(runs({ key: 'j', code: 'KeyJ' }, { scope: 'welcome', text: true })).toBeUndefined();
  });

  it('leaves Tab to the browser, which walks its controls, the arrows and Space to its cards, and j, k and c to the practice diff', () => {
    for (const [key, code] of [
      ['Tab', 'Tab'],
      ['j', 'KeyJ'],
      ['k', 'KeyK'],
      ['h', 'KeyH'],
      ['l', 'KeyL'],
      ['c', 'KeyC'],
      [' ', 'Space'],
      ['ArrowLeft', 'ArrowLeft'],
      ['ArrowRight', 'ArrowRight'],
      ['ArrowUp', 'ArrowUp'],
      ['ArrowDown', 'ArrowDown'],
    ]) {
      expect(runs({ key, code }, { scope: 'welcome', text: false })).toBeUndefined();
    }
  });

  it('opens again with a command that has no key', () => {
    expect(commands.find((command) => command.id === 'welcome.show')?.keys).toEqual([]);
  });

  it('names its scope', () => {
    expect(keys.scopes).toEqual(['welcome']);
  });
});
