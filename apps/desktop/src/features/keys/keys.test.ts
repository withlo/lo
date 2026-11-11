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
