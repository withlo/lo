import { describe, expect, test } from 'vitest';

import {
  eventStroke,
  eventStrokes,
  keyLabels,
  parseKeys,
  readKeys,
  strokeOf,
  systemStrokes,
  vimKeys,
  writeKeys,
  type KeyEventLike,
  type System,
} from './notation.ts';

/** The ids of the strokes `text` is on `system`. */
function ids(text: string, system: System = 'mac'): string[] {
  return systemStrokes(parseKeys(text), system).map((each) => each.id);
}

function event(key: string, held: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key,
    code: held.code ?? '',
    metaKey: held.metaKey ?? false,
    ctrlKey: held.ctrlKey ?? false,
    altKey: held.altKey ?? false,
    shiftKey: held.shiftKey ?? false,
    ...(held.getModifierState ? { getModifierState: held.getModifierState } : {}),
  };
}

const altGraph = (key: string) => key === 'AltGraph';

/** The ids of the strokes a keydown can be, the likelier first. */
function read(key: string, held: Partial<KeyEventLike>): string[] {
  return eventStrokes(event(key, held)).map((each) => each.id);
}

/** How `system` shows `text`. */
function forms(text: string, system: System): string[] {
  return keyLabels(systemStrokes(parseKeys(text), system), system);
}

/** `text` in Vim's notation. */
function vim(text: string, system: System = 'mac'): string {
  return vimKeys(systemStrokes(parseKeys(text), system));
}

describe('notation', () => {
  test('reads chords with plus signs and sequences with spaces', () => {
    expect(parseKeys('cmd+shift+p')).toEqual([
      { key: 'p', cmd: true, ctrl: false, alt: false, shift: true },
    ]);
    expect(ids('] f')).toEqual([']', 'f']);
    expect(ids('g S')).toEqual(['g', 'S']);
    expect(ids('esc  esc')).toEqual(['esc', 'esc']);
  });

  test('writes each keystroke one way', () => {
    // A lone letter's case is the key, and Shift on its own is folded into it.
    expect(ids('shift+g')).toEqual(ids('G'));
    expect(ids('shift+/')).toEqual(ids('?'));
    // With a modifier, Shift is a modifier of its own, and the key is the unshifted one.
    expect(ids('cmd+P')).toEqual(ids('cmd+shift+p'));
    expect(ids('cmd+}')).toEqual(['meta+shift+]']);
    expect(ids('cmd+shift+}')).toEqual(['meta+shift+]']);
    // Modifiers and names in any case; `plus` for `+`.
    expect(ids('Ctrl+Shift+Tab')).toEqual(['ctrl+shift+tab']);
    expect(ids('ENTER')).toEqual(['enter']);
    expect(ids('plus')).toEqual(['+']);
    expect(ids('+')).toEqual(['+']);
    expect(ids('ctrl++')).toEqual(ids('ctrl+shift+='));
    expect(writeKeys(parseKeys('Shift+Ctrl+TAB  ]  shift+g'))).toBe('ctrl+shift+tab ] G');
  });

  test('says why keys can’t be read', () => {
    expect(readKeys('')).toEqual({ error: 'No keys.' });
    expect(readKeys('cmd+')).toEqual({ error: '"cmd+" has no key after its last "+".' });
    expect(readKeys('+p')).toEqual({ error: '"+p" has a "+" with nothing before it.' });
    expect(readKeys('meta+p')).toEqual({
      error: '"meta" in "meta+p" isn\'t a modifier: use cmd, ctrl, alt or shift.',
    });
    expect(readKeys('shift+ctrl+shift+a')).toEqual({
      error: '"shift+ctrl+shift+a" holds shift twice.',
    });
    expect(readKeys('g escape')).toEqual({
      error: '"escape" isn\'t a key: write one character, or a name such as enter.',
    });
    expect(() => parseKeys('cmd+')).toThrow('Keys "cmd+": "cmd+" has no key after its last "+".');
  });

  test('cmd is ⌘ on macOS and Ctrl on Linux, and ctrl is ⌃ on both', () => {
    expect(ids('cmd+o', 'mac')).toEqual(['meta+o']);
    expect(ids('cmd+o', 'linux')).toEqual(['ctrl+o']);
    expect(ids('ctrl+o', 'mac')).toEqual(['ctrl+o']);
    expect(ids('ctrl+o', 'linux')).toEqual(['ctrl+o']);
    // So on Linux the two are one key, which is why ⌘O is a macOS alias only.
    expect(ids('cmd+ctrl+o', 'linux')).toEqual(['ctrl+o']);
  });
});

describe('key events', () => {
  test('a character typed on its own carries its Shift', () => {
    expect(eventStroke(event('g'))?.id).toBe('g');
    expect(eventStroke(event('G', { shiftKey: true }))?.id).toBe('G');
    expect(eventStroke(event('?', { shiftKey: true, code: 'Slash' }))?.id).toBe('?');
    expect(eventStroke(event(']'))?.id).toBe(']');
  });

  test('named keys keep Shift as a modifier', () => {
    expect(eventStroke(event('Tab', { shiftKey: true }))?.id).toBe('shift+tab');
    expect(eventStroke(event(' '))?.id).toBe('space');
    expect(eventStroke(event('Escape'))?.id).toBe('esc');
    expect(eventStroke(event('ArrowDown'))?.id).toBe('down');
    expect(eventStroke(event('F5'))?.id).toBe('f5');
  });

  test('with ⌘ or Ctrl, a letter is lowercase and Shift a modifier, whatever event.key says', () => {
    expect(eventStroke(event('p', { metaKey: true, shiftKey: true }))?.id).toBe('meta+shift+p');
    expect(eventStroke(event('P', { metaKey: true, shiftKey: true }))?.id).toBe('meta+shift+p');
    // Caps Lock gives a capital without Shift.
    expect(eventStroke(event('P', { metaKey: true }))?.id).toBe('meta+p');
    expect(eventStroke(event('O', { ctrlKey: true, shiftKey: true }))?.id).toBe('ctrl+shift+o');
  });

  test('with ⌘ or Ctrl, a shifted symbol is read by its code', () => {
    const next = { metaKey: true, shiftKey: true, code: 'BracketRight' };
    expect(eventStroke(event('}', next))?.id).toBe('meta+shift+]');
    expect(eventStroke(event(']', next))?.id).toBe('meta+shift+]');
    expect(eventStroke(event(']', next))?.id).toBe(ids('cmd+shift+]')[0]);
    expect(eventStroke(event('|', { ctrlKey: true, shiftKey: true, code: 'Backslash' }))?.id).toBe(
      'ctrl+shift+\\',
    );
  });

  test('⌥ reads as the character the layout typed, then as ⌥ and the key’s place', () => {
    // ⌥A types å on a US Mac; German types ] with ⌥6.
    expect(read('å', { altKey: true, code: 'KeyA' })).toEqual(['å', 'alt+a']);
    expect(read('Å', { altKey: true, shiftKey: true, code: 'KeyA' })).toEqual(['Å', 'alt+shift+a']);
    expect(read(']', { altKey: true, code: 'Digit6' })).toEqual([']', 'alt+6']);
    // A dead key (⌥E is an accent) is only ⌥ and its place.
    expect(read('Dead', { altKey: true, code: 'KeyE' })).toEqual(['alt+e']);
    // ⌥Space types a non-breaking space, which isn't a character to match.
    expect(read('\u00a0', { altKey: true, code: 'Space' })).toEqual(['alt+space']);
    expect(read('Enter', { altKey: true, code: 'Enter' })).toEqual(['alt+enter']);
    // With ⌘ or Ctrl as well, only the place counts.
    expect(read('ı', { altKey: true, metaKey: true, code: 'KeyI' })).toEqual(ids('cmd+alt+i'));
  });

  test('⌘ and Ctrl read a letter outside A to Z by its place', () => {
    // Russian: з is where P is.
    expect(eventStroke(event('з', { ctrlKey: true, code: 'KeyP' }))?.id).toBe('ctrl+p');
    expect(eventStroke(event('З', { metaKey: true, shiftKey: true, code: 'KeyP' }))?.id).toBe(
      'meta+shift+p',
    );
    // German ü is where [ is: Vim's Ctrl+[ there.
    expect(eventStroke(event('ü', { ctrlKey: true, code: 'BracketLeft' }))?.id).toBe('ctrl+[');
    // A letter outside A to Z with no known place is kept.
    expect(eventStroke(event('ß', { ctrlKey: true, code: 'IntlRo' }))?.id).toBe('ctrl+ß');
  });

  test('a dead key on its own matches nothing, so the accent it starts is typed', () => {
    // US-International's `, German's ^ where US has `, and French's ^ where US has [.
    expect(eventStrokes(event('Dead', { code: 'Backquote' }))).toEqual([]);
    expect(eventStrokes(event('Dead', { shiftKey: true, code: 'Backquote' }))).toEqual([]);
    expect(eventStrokes(event('Dead', { code: 'BracketLeft' }))).toEqual([]);
  });

  test('Linux’s Alt leaves the key as it is, so it reads only as a chord', () => {
    expect(read('e', { altKey: true, code: 'KeyE' })).toEqual(['alt+e']);
    expect(read('E', { altKey: true, shiftKey: true, code: 'KeyE' })).toEqual(['alt+shift+e']);
    expect(read(']', { altKey: true, code: 'BracketRight' })).toEqual(['alt+]']);
    expect(read('}', { altKey: true, shiftKey: true, code: 'BracketRight' })).toEqual([
      'alt+shift+]',
    ]);
    // A US Mac's ⌥⇧` types a plain `, which is the key's own: not the `` ` `` key.
    expect(read('`', { altKey: true, shiftKey: true, code: 'Backquote' })).toEqual(['alt+shift+`']);
  });

  test('the keyboard’s layout says what each key types on its own', () => {
    // German has z where US has y, and AZERTY a where US has q.
    const german = new Map([['KeyY', 'z']]);
    const azerty = new Map([['KeyQ', 'a']]);
    expect(
      eventStrokes(event('z', { altKey: true, code: 'KeyY' }), german).map((each) => each.id),
    ).toEqual(['alt+z']);
    expect(
      eventStrokes(event('a', { altKey: true, code: 'KeyQ' }), azerty).map((each) => each.id),
    ).toEqual(['alt+a']);
    // Without the layout, the place is a US keyboard's.
    expect(read('z', { altKey: true, code: 'KeyY' })).toEqual(['z', 'alt+y']);
    // A layout outside ASCII, such as Russian, still reads ⌥ chords by their US place.
    const russian = new Map([['KeyP', 'з']]);
    expect(
      eventStrokes(event('з', { altKey: true, code: 'KeyP' }), russian).map((each) => each.id),
    ).toEqual(['alt+p']);
  });

  test('modifier keys, dead keys and AltGr’s characters are no chord', () => {
    expect(eventStroke(event('Shift', { shiftKey: true }))).toBeUndefined();
    expect(eventStroke(event('Meta', { metaKey: true }))).toBeUndefined();
    expect(eventStroke(event('Dead'))).toBeUndefined();
    expect(eventStroke(event('Unidentified'))).toBeUndefined();
    expect(eventStroke(event('Process'))).toBeUndefined();
    expect(
      eventStroke(
        event('@', { ctrlKey: true, altKey: true, code: 'KeyQ', getModifierState: altGraph }),
      )?.id,
    ).toBe('@');
  });
});

describe('display forms', () => {
  test('macOS shows symbols, as the design writes keys', () => {
    expect(forms('cmd+shift+p', 'mac')).toEqual(['⌘⇧P']);
    expect(forms('cmd+enter', 'mac')).toEqual(['⌘⏎']);
    expect(forms('cmd+shift+enter', 'mac')).toEqual(['⌘⇧⏎']);
    expect(forms('alt+enter', 'mac')).toEqual(['⌥⏎']);
    expect(forms('cmd+alt+i', 'mac')).toEqual(['⌘⌥I']);
    expect(forms('cmd+shift+]', 'mac')).toEqual(['⌘⇧]']);
    expect(forms('cmd+\\', 'mac')).toEqual(['⌘\\']);
    // Vim's keys keep their lowercase letter.
    expect(forms('ctrl+o', 'mac')).toEqual(['⌃o']);
    expect(forms('ctrl+tab', 'mac')).toEqual(['⌃⇥']);
    expect(forms('ctrl+shift+tab', 'mac')).toEqual(['⌃⇧⇥']);
    expect(forms('shift+tab', 'mac')).toEqual(['⇧Tab']);
    expect(forms('tab', 'mac')).toEqual(['Tab']);
    // A sequence is separate keys.
    expect(forms('] f', 'mac')).toEqual([']', 'f']);
    expect(forms('g S', 'mac')).toEqual(['g', 'S']);
    expect(forms('esc esc', 'mac')).toEqual(['Esc', 'Esc']);
    expect(forms('enter', 'mac')).toEqual(['⏎']);
    expect(forms('left right', 'mac')).toEqual(['←', '→']);
  });

  test('Linux spells modifiers out, with Ctrl for cmd', () => {
    expect(forms('cmd+shift+p', 'linux')).toEqual(['Ctrl+Shift+P']);
    expect(forms('cmd+l', 'linux')).toEqual(['Ctrl+L']);
    expect(forms('ctrl+o', 'linux')).toEqual(['Ctrl+O']);
    expect(forms('alt+enter', 'linux')).toEqual(['Alt+Enter']);
    expect(forms('ctrl+shift+tab', 'linux')).toEqual(['Ctrl+Shift+Tab']);
    expect(forms('shift+tab', 'linux')).toEqual(['Shift+Tab']);
    expect(forms('cmd+plus', 'linux')).toEqual(['Ctrl+Shift+=']);
    expect(forms('] f', 'linux')).toEqual([']', 'f']);
    expect(forms('enter', 'linux')).toEqual(['Enter']);
    expect(forms('esc esc', 'linux')).toEqual(['Esc', 'Esc']);
  });
});

test('Vim’s notation, as code views take held keys and motions', () => {
  expect(vim('] f')).toBe(']f');
  expect(vim('g S')).toBe('gS');
  expect(vim('ctrl+o')).toBe('<C-o>');
  expect(vim('cmd+o', 'linux')).toBe('<C-o>');
  expect(vim('cmd+s', 'mac')).toBe('<D-s>');
  expect(vim('enter')).toBe('<CR>');
  expect(vim('esc esc')).toBe('<Esc><Esc>');
  expect(vim('shift+tab')).toBe('<S-Tab>');
  expect(vim('space')).toBe('<Space>');
  expect(vim('<')).toBe('<lt>');
  expect(vimKeys([strokeOf('w', { ctrl: true }), strokeOf('j')])).toBe('<C-w>j');
});
