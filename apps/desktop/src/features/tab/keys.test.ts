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

const window: Focus = { scope: 'window', text: false };
const view = (scope: string, mode: 'normal' | 'visual' | 'insert' = 'normal'): Focus => ({
  scope,
  text: false,
  view: { mode, pending: false },
});

describe('the tab keys', () => {
  it('⌘1 to ⌘8 show a tab by its place, and ⌘9 the last, on both systems', () => {
    for (const system of ['mac', 'linux'] as const) {
      expect(
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => runs(`cmd+${number}`, window, system)),
      ).toEqual([
        'tab.show1',
        'tab.show2',
        'tab.show3',
        'tab.show4',
        'tab.show5',
        'tab.show6',
        'tab.show7',
        'tab.show8',
        'tab.showLast',
      ]);
    }
  });

  it('⌘⇧] and ⌘⇧[, and ⌃⇥ and ⌃⇧⇥, step through the tabs on both systems', () => {
    for (const system of ['mac', 'linux'] as const) {
      expect(runs('cmd+shift+]', window, system)).toBe('tab.next');
      expect(runs('ctrl+tab', view('diff'), system)).toBe('tab.next');
      expect(runs('cmd+shift+[', view('tree'), system)).toBe('tab.previous');
      expect(runs('ctrl+shift+tab', window, system)).toBe('tab.previous');
    }
  });

  it('work from a text field and a code view, but not under a dialog or a palette', () => {
    expect(runs('cmd+2', { scope: 'window', text: true })).toBe('tab.show2');
    expect(runs('cmd+w', view('box', 'insert'))).toBe('tab.close');
    expect(runs('cmd+w', view('diff', 'visual'))).toBe('tab.close');
    for (const scope of ['dialog', 'palette']) {
      for (const key of ['cmd+1', 'cmd+9', 'cmd+shift+]', 'ctrl+tab', 'cmd+w']) {
        expect(runs(key, { scope, text: false })).toBeUndefined();
      }
    }
  });

  it('Ctrl+W closes the tab on Linux, except in a comment box in insert mode, where it deletes a word', () => {
    expect(runs('cmd+w', window, 'linux')).toBe('tab.close');
    expect(runs('cmd+w', view('diff'), 'linux')).toBe('tab.close');
    expect(runs('cmd+w', view('box', 'insert'), 'linux')).toBeUndefined();
  });

  it('close the tab right-clicked, or the one on screen', () => {
    const close = commands.find(({ name }) => name === 'close');
    expect(close?.targets).toEqual(['tab', 'none']);
    expect(close?.menu?.on).toBe('tab');
  });
});
