import {
  Bindings,
  commandsOf,
  declaredBindings,
  eventStroke,
  keyless,
  match,
  type Focus,
  type KeyEventLike,
  type System,
} from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import keys from './keys.ts';

const commands = commandsOf(keys);

/** What a keydown runs where `focus` is, on `system`. */
function runs(
  event: Partial<KeyEventLike>,
  focus: Focus,
  system: System = 'linux',
): string | undefined {
  const bindings = new Bindings(system, declaredBindings(commands, system));
  const stroke = eventStroke(
    { key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...event },
    { system },
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

const anywhere: Focus = { scope: 'window', text: false };
const box: Focus = { scope: 'box', text: false, view: { mode: 'insert', pending: false } };
const diff: Focus = { scope: 'diff', text: false, view: { mode: 'normal', pending: false } };

describe('on Linux, which has no app menu', () => {
  it('Ctrl+Q quits, anywhere', () => {
    for (const focus of [anywhere, box, diff]) {
      expect(runs({ key: 'q', code: 'KeyQ', ctrlKey: true }, focus)).toBe('app.quit');
    }
  });

  it('Ctrl with =, +, - and 0 zooms, on any layout', () => {
    expect(runs({ key: '=', code: 'Equal', ctrlKey: true }, anywhere)).toBe('app.zoomIn');
    expect(runs({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }, anywhere)).toBe(
      'app.zoomIn',
    );
    // German has + on a key of its own.
    expect(runs({ key: '+', code: 'BracketRight', ctrlKey: true }, anywhere)).toBe('app.zoomIn');
    expect(runs({ key: '-', code: 'Minus', ctrlKey: true }, box)).toBe('app.zoomOut');
    expect(runs({ key: '0', code: 'Digit0', ctrlKey: true }, diff)).toBe('app.actualSize');
  });

  it('F11 goes full screen', () => {
    expect(runs({ key: 'F11', code: 'F11' }, anywhere)).toBe('app.fullScreen');
  });
});

describe('on macOS', () => {
  it('leaves quitting and full screen to the app menu', () => {
    expect(runs({ key: 'q', code: 'KeyQ', metaKey: true }, anywhere, 'mac')).toBeUndefined();
    expect(runs({ key: 'F11', code: 'F11' }, anywhere, 'mac')).toBeUndefined();
  });

  it('zooms with ⌘ and =, +, - and 0, and lists zooming in the View menu', () => {
    expect(runs({ key: '=', code: 'Equal', metaKey: true }, anywhere, 'mac')).toBe('app.zoomIn');
    expect(runs({ key: '+', code: 'Equal', metaKey: true, shiftKey: true }, anywhere, 'mac')).toBe(
      'app.zoomIn',
    );
    expect(runs({ key: '-', code: 'Minus', metaKey: true }, diff, 'mac')).toBe('app.zoomOut');
    expect(runs({ key: '0', code: 'Digit0', metaKey: true }, box, 'mac')).toBe('app.actualSize');
    expect(
      commands.filter((command) => command.bar?.menu === 'View').map((command) => command.id),
    ).toEqual(['app.zoomIn', 'app.zoomOut', 'app.actualSize']);
  });
});

/** The command with this id. */
const find = (id: string) => commands.find((command) => command.id === id);

describe('About and the licenses', () => {
  it('give no key, since they are done once in a while, and each has a menu to be found in', () => {
    const about = find('app.about');
    const licenses = find('app.licenses');
    expect([about?.keys, licenses?.keys]).toEqual([[], []]);
    expect([about && keyless(about), licenses && keyless(licenses)]).toEqual([true, true]);
  });

  it('About Lo is Linux’s, in the right-click menu of the window, where macOS’s app menu has About', () => {
    expect(find('app.about')?.when).toEqual({ system: 'linux' });
    expect(find('app.about')?.menu).toMatchObject({ on: 'none' });
    expect(find('app.about')?.bar).toBeUndefined();
  });

  it('Show licenses is in the app menu on macOS, ahead of the other commands that sit under About', () => {
    expect(find('app.licenses')?.bar).toEqual({ menu: 'App', order: 5 });
    expect(find('app.licenses')?.when).toBeUndefined();
  });
});
