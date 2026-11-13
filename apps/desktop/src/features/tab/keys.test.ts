import {
  Bindings,
  commandsOf,
  declaredBindings,
  match,
  menuPlaces,
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
    expect(close && menuPlaces(close)[0]?.on).toBe('tab');
  });

  it('⌃⇧PageUp and ⌃⇧PageDown move a tab, from anywhere but a dialog or a palette, on both systems', () => {
    for (const system of ['mac', 'linux'] as const) {
      expect(runs('ctrl+shift+pageup', window, system)).toBe('tab.moveLeft');
      expect(runs('ctrl+shift+pagedown', window, system)).toBe('tab.moveRight');
      expect(runs('ctrl+shift+pageup', { scope: 'window', text: true }, system)).toBe(
        'tab.moveLeft',
      );
      expect(runs('ctrl+shift+pagedown', view('diff'), system)).toBe('tab.moveRight');
      expect(runs('ctrl+shift+pageup', view('box', 'insert'), system)).toBe('tab.moveLeft');
      // Vim keeps its own PageUp and PageDown.
      expect(runs('pageup', view('diff'), system)).toBeUndefined();
    }
    for (const scope of ['dialog', 'palette']) {
      expect(runs('ctrl+shift+pageup', { scope, text: false })).toBeUndefined();
      expect(runs('ctrl+shift+pagedown', { scope, text: false })).toBeUndefined();
    }
    // The tab right-clicked, or the one on screen, in its right-click menu before Close tab.
    const moves = commands.filter(({ name }) => name === 'moveLeft' || name === 'moveRight');
    expect(moves.map(({ label }) => label)).toEqual(['Move tab left', 'Move tab right']);
    for (const move of moves) {
      expect(move.targets).toEqual(['tab', 'none']);
      const close = commands.find(({ name }) => name === 'close');
      expect(menuPlaces(move)[0]?.on).toBe('tab');
      expect(menuPlaces(move)[0]?.order).toBeLessThan((close && menuPlaces(close)[0]?.order) ?? 0);
    }
  });

  it('⌘⇧A opens the tabs that don’t fit, and ⌘\\ the left panel, from anywhere but a dialog or a palette', () => {
    for (const system of ['mac', 'linux'] as const) {
      expect(runs('cmd+shift+a', window, system)).toBe('tab.more');
      expect(runs('cmd+shift+a', view('diff'), system)).toBe('tab.more');
      expect(runs('cmd+\\', window, system)).toBe('tab.leftPanel');
      expect(runs('cmd+\\', { scope: 'window', text: true }, system)).toBe('tab.leftPanel');
    }
    for (const scope of ['dialog', 'palette']) {
      expect(runs('cmd+shift+a', { scope, text: false })).toBeUndefined();
      expect(runs('cmd+\\', { scope, text: false })).toBeUndefined();
    }
  });

  it('` and ~ step through the middle views, over Vim’s marks, but not in a comment box or a text field', () => {
    expect(runs('`', window)).toBe('tab.nextView');
    expect(runs('~', window)).toBe('tab.previousView');
    expect(runs('`', view('diff'))).toBe('tab.nextView');
    expect(runs('~', view('file'))).toBe('tab.previousView');
    expect(runs('`', view('diff', 'visual'))).toBeUndefined();
    expect(runs('`', view('box', 'insert'))).toBeUndefined();
    expect(runs('`', { scope: 'window', text: true })).toBeUndefined();
    expect(runs('`', { scope: 'menu', text: false })).toBeUndefined();
  });
});
