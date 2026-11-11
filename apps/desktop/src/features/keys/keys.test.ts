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

/** What a key runs where `focus` is, on `system`. */
function runs(key: string, focus: Focus, system: System = 'mac'): string | undefined {
  const bindings = new Bindings(system, declaredBindings(commands, system));
  const [stroke] = systemStrokes(parseKeys(key), system);
  const { outcome } = match(
    bindings,
    undefined,
    { stroke: stroke!, repeat: false, composing: false, time: 0 },
    focus,
  );
  return outcome.kind === 'run' ? outcome.command.id : undefined;
}

const view = (scope: string, mode: 'normal' | 'visual' | 'insert' = 'normal'): Focus => ({
  scope,
  text: false,
  view: { mode, pending: false },
});

/** What `g` then `,` run where `focus` is. */
function opens(focus: Focus, system: System = 'mac'): boolean {
  const bindings = new Bindings(system, declaredBindings(commands, system));
  let pending;
  let outcome;
  for (const key of ['g', ',']) {
    const [stroke] = systemStrokes(parseKeys(key), system);
    ({ pending, outcome } = match(
      bindings,
      pending,
      { stroke: stroke!, repeat: false, composing: false, time: 0 },
      focus,
    ));
  }
  return outcome?.kind === 'run' && outcome.command.id === 'keys.openKeymap';
}

describe("the registry's own keys", () => {
  it('Esc goes back to the middle view, except where Esc closes something or is Vim’s', () => {
    expect(runs('esc', { scope: 'window', text: false })).toBe('keys.escape');
    expect(runs('esc', { scope: 'tree', text: false })).toBe('keys.escape');
    expect(runs('esc', view('diff'))).toBe('keys.escape');
    for (const scope of ['menu', 'dialog', 'palette']) {
      expect(runs('esc', { scope, text: false })).toBeUndefined();
    }
    expect(runs('esc', view('box'))).toBeUndefined();
    expect(runs('esc', view('diff', 'visual'))).toBeUndefined();
  });

  it('⌃o and ⌃i walk the history everywhere but a box, where they’re Vim’s', () => {
    for (const system of ['mac', 'linux'] as const) {
      expect(runs('ctrl+o', view('diff'), system)).toBe('keys.back');
      expect(runs('ctrl+i', { scope: 'window', text: false }, system)).toBe('keys.forward');
      expect(runs('ctrl+o', view('box'), system)).toBeUndefined();
    }
  });
});

describe('the keymap file', () => {
  it('g , opens it, anywhere but where g is typed or is Vim’s', () => {
    for (const system of ['mac', 'linux'] as const) {
      expect(opens({ scope: 'window', text: false }, system)).toBe(true);
      expect(opens({ scope: 'tree', text: false }, system)).toBe(true);
      expect(opens(view('diff'), system)).toBe(true);
      expect(opens(view('diff', 'visual'), system)).toBe(false);
      expect(opens(view('box'), system)).toBe(false);
      for (const scope of ['menu', 'dialog', 'palette']) {
        expect(opens({ scope, text: false }, system)).toBe(false);
      }
      expect(opens({ scope: 'window', text: true }, system)).toBe(false);
    }
  });
});

describe('key help and the palette', () => {
  it('? shows every key, anywhere but in a field, where it’s typed', () => {
    expect(runs('?', { scope: 'window', text: false })).toBe('keys.help');
    expect(runs('?', view('diff'))).toBe('keys.help');
    expect(runs('?', { scope: 'dialog', text: false })).toBe('keys.help');
    expect(runs('?', { scope: 'palette', text: true })).toBeUndefined();
    expect(runs('?', { scope: 'window', text: true })).toBeUndefined();
  });

  it('⌘⇧P opens the palette, even from a field', () => {
    expect(runs('cmd+shift+p', { scope: 'window', text: true })).toBe('keys.palette');
    expect(runs('cmd+shift+p', view('box', 'insert'), 'linux')).toBe('keys.palette');
  });

  it('⌥⏎ shows the highlighted action’s key, in the palette only', () => {
    expect(runs('alt+enter', { scope: 'palette', text: true })).toBe('keys.showKey');
    expect(runs('alt+enter', { scope: 'window', text: false })).toBeUndefined();
    expect(runs('alt+enter', { scope: 'palette', text: true }, 'linux')).toBe('keys.showKey');
  });
});
