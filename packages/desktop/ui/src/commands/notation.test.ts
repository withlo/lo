import { describe, expect, test } from 'vitest';

import {
  ariaShortcut,
  contradicts,
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
  type Reading,
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

const mac: Reading = { system: 'mac' };
const linux: Reading = { system: 'linux' };

/** The ids of the strokes a keydown can be, the likelier first. */
function read(key: string, held: Partial<KeyEventLike>, reading: Reading = mac): string[] {
  return eventStrokes(event(key, held), reading).map((each) => each.id);
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
    expect(eventStroke(event('g'), mac)?.id).toBe('g');
    expect(eventStroke(event('G', { shiftKey: true }), mac)?.id).toBe('G');
    expect(eventStroke(event('?', { shiftKey: true, code: 'Slash' }), mac)?.id).toBe('?');
    expect(eventStroke(event(']'), mac)?.id).toBe(']');
  });

  test('named keys keep Shift as a modifier', () => {
    expect(eventStroke(event('Tab', { shiftKey: true }), mac)?.id).toBe('shift+tab');
    expect(eventStroke(event(' '), mac)?.id).toBe('space');
    expect(eventStroke(event('Escape'), mac)?.id).toBe('esc');
    expect(eventStroke(event('ArrowDown'), mac)?.id).toBe('down');
    expect(eventStroke(event('F5'), mac)?.id).toBe('f5');
  });

  test('the context-menu key and Shift and F10 are keys of their own', () => {
    expect(eventStroke(event('ContextMenu'), mac)?.id).toBe('menu');
    expect(eventStroke(event('F10', { shiftKey: true }), mac)?.id).toBe('shift+f10');
    expect(ids('menu', 'linux')).toEqual(['menu']);
    expect(ids('shift+f10', 'mac')).toEqual(['shift+f10']);
  });

  test('with ⌘ or Ctrl, a letter is lowercase and Shift a modifier, whatever event.key says', () => {
    expect(eventStroke(event('p', { metaKey: true, shiftKey: true }), mac)?.id).toBe(
      'meta+shift+p',
    );
    expect(eventStroke(event('P', { metaKey: true, shiftKey: true }), mac)?.id).toBe(
      'meta+shift+p',
    );
    // Caps Lock gives a capital without Shift.
    expect(eventStroke(event('P', { metaKey: true }), mac)?.id).toBe('meta+p');
    expect(eventStroke(event('O', { ctrlKey: true, shiftKey: true }), mac)?.id).toBe(
      'ctrl+shift+o',
    );
  });

  test('with ⌘ or Ctrl, a shifted symbol is read by its code', () => {
    const next = { metaKey: true, shiftKey: true, code: 'BracketRight' };
    expect(eventStroke(event('}', next), mac)?.id).toBe('meta+shift+]');
    expect(eventStroke(event(']', next), mac)?.id).toBe('meta+shift+]');
    expect(eventStroke(event(']', next), mac)?.id).toBe(ids('cmd+shift+]')[0]);
    expect(
      eventStroke(event('|', { ctrlKey: true, shiftKey: true, code: 'Backslash' }), mac)?.id,
    ).toBe('ctrl+shift+\\');
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
    expect(eventStroke(event('з', { ctrlKey: true, code: 'KeyP' }), mac)?.id).toBe('ctrl+p');
    expect(eventStroke(event('З', { metaKey: true, shiftKey: true, code: 'KeyP' }), mac)?.id).toBe(
      'meta+shift+p',
    );
    // German ü is where [ is: Vim's Ctrl+[ there.
    expect(eventStroke(event('ü', { ctrlKey: true, code: 'BracketLeft' }), mac)?.id).toBe('ctrl+[');
    // A letter outside A to Z with no known place is kept.
    expect(eventStroke(event('ß', { ctrlKey: true, code: 'IntlRo' }), mac)?.id).toBe('ctrl+ß');
  });

  test('a dead key on its own matches nothing, so the accent it starts is typed', () => {
    // US-International's `, German's ^ where US has `, and French's ^ where US has [.
    expect(eventStrokes(event('Dead', { code: 'Backquote' }), mac)).toEqual([]);
    expect(eventStrokes(event('Dead', { shiftKey: true, code: 'Backquote' }), mac)).toEqual([]);
    expect(eventStrokes(event('Dead', { code: 'BracketLeft' }), mac)).toEqual([]);
  });

  test('Linux’s Alt types nothing, so it’s read as Ctrl is, by the key itself', () => {
    expect(read('e', { altKey: true, code: 'KeyE' }, linux)).toEqual(['alt+e']);
    expect(read('E', { altKey: true, shiftKey: true, code: 'KeyE' }, linux)).toEqual([
      'alt+shift+e',
    ]);
    expect(read(']', { altKey: true, code: 'BracketRight' }, linux)).toEqual(['alt+]']);
    expect(read('}', { altKey: true, shiftKey: true, code: 'BracketRight' }, linux)).toEqual([
      'alt+shift+]',
    ]);
    // French has z where US has w; with no layout map, Alt+Z is still Alt+Z.
    expect(read('z', { altKey: true, code: 'KeyW' }, linux)).toEqual(['alt+z']);
    // A German map left over from before a switch to US says KeyZ types y: it isn't used.
    const staleGerman = new Map([['KeyZ', 'y']]);
    expect(
      read('z', { altKey: true, code: 'KeyZ' }, { system: 'linux', layout: staleGerman }),
    ).toEqual(['alt+z']);
    // Russian з is where P is.
    expect(read('з', { altKey: true, code: 'KeyP' }, linux)).toEqual(['alt+p']);
  });

  test('a US Mac’s ⌥⇧` types a plain `, the key’s own, so it’s only ⌥ with the key', () => {
    expect(read('`', { altKey: true, shiftKey: true, code: 'Backquote' })).toEqual(['alt+shift+`']);
  });

  test('a key pressed on its own shows a layout is out of date', () => {
    const german = new Map([
      ['KeyY', 'z'],
      ['KeyZ', 'y'],
    ]);
    // A US keyboard's z, where German has y.
    expect(contradicts(german, event('z', { code: 'KeyZ' }))).toBe(true);
    expect(contradicts(german, event('Z', { shiftKey: true, code: 'KeyZ' }))).toBe(true);
    expect(contradicts(german, event('y', { code: 'KeyZ' }))).toBe(false);
    expect(contradicts(undefined, event('z', { code: 'KeyZ' }))).toBe(false);
    // On no map, a US keyboard is assumed: German z where US has y disagrees.
    expect(contradicts(undefined, event('z', { code: 'KeyY' }))).toBe(true);
    // Only keys the layout can speak for: not chords, dead keys, AltGr or a shifted symbol.
    expect(contradicts(german, event('z', { ctrlKey: true, code: 'KeyZ' }))).toBe(false);
    expect(contradicts(german, event('Dead', { code: 'KeyZ' }))).toBe(false);
    expect(contradicts(german, event('?', { shiftKey: true, code: 'Minus' }))).toBe(false);
    expect(contradicts(german, event('@', { code: 'KeyZ', getModifierState: altGraph }))).toBe(
      false,
    );
  });

  test('the keyboard’s layout says what each key types on its own', () => {
    // German has z where US has y, and AZERTY a where US has q.
    const german = new Map([['KeyY', 'z']]);
    const azerty = new Map([['KeyQ', 'a']]);
    expect(
      eventStrokes(event('z', { altKey: true, code: 'KeyY' }), {
        system: 'mac',
        layout: german,
      }).map((each) => each.id),
    ).toEqual(['alt+z']);
    expect(
      eventStrokes(event('a', { altKey: true, code: 'KeyQ' }), {
        system: 'mac',
        layout: azerty,
      }).map((each) => each.id),
    ).toEqual(['alt+a']);
    // Without the layout, the place is a US keyboard's.
    expect(read('z', { altKey: true, code: 'KeyY' })).toEqual(['z', 'alt+y']);
    // A layout outside ASCII, such as Russian, still reads ⌥ chords by their US place.
    const russian = new Map([['KeyP', 'з']]);
    expect(
      eventStrokes(event('з', { altKey: true, code: 'KeyP' }), {
        system: 'mac',
        layout: russian,
      }).map((each) => each.id),
    ).toEqual(['alt+p']);
  });

  test('modifier keys, dead keys and AltGr’s characters are no chord', () => {
    expect(eventStroke(event('Shift', { shiftKey: true }), mac)).toBeUndefined();
    expect(eventStroke(event('Meta', { metaKey: true }), mac)).toBeUndefined();
    expect(eventStroke(event('Dead'), mac)).toBeUndefined();
    expect(eventStroke(event('Unidentified'), mac)).toBeUndefined();
    expect(eventStroke(event('Process'), mac)).toBeUndefined();
    expect(
      eventStroke(
        event('@', { ctrlKey: true, altKey: true, code: 'KeyQ', getModifierState: altGraph }),
        linux,
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
    expect(forms('menu', 'mac')).toEqual(['Menu']);
    expect(forms('shift+f10', 'mac')).toEqual(['⇧F10']);
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
    expect(forms('menu', 'linux')).toEqual(['Menu']);
    expect(forms('shift+f10', 'linux')).toEqual(['Shift+F10']);
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

/** `keys` as `aria-keyshortcuts` says them on `system`. */
function aria(keys: string, system: System = 'mac') {
  return ariaShortcut(systemStrokes(parseKeys(keys), system));
}

describe('aria-keyshortcuts', () => {
  test('a key or a chord is written as ARIA writes it', () => {
    expect(aria('cmd+shift+p')).toBe('Meta+Shift+P');
    expect(aria('cmd+shift+p', 'linux')).toBe('Control+Shift+P');
    expect(aria('ctrl+o')).toBe('Control+O');
    expect(aria('alt+enter')).toBe('Alt+Enter');
    expect(aria('shift+f10')).toBe('Shift+F10');
    expect(aria('e')).toBe('e');
    expect(aria('?')).toBe('?');
    expect(aria('G')).toBe('G');
    expect(aria('enter')).toBe('Enter');
    expect(aria('esc')).toBe('Escape');
    expect(aria('down')).toBe('ArrowDown');
    expect(aria('menu')).toBe('ContextMenu');
    expect(aria('cmd+plus')).toBe('Meta+Shift+=');
  });

  test('a sequence has none', () => {
    expect(aria('] f')).toBeUndefined();
    expect(aria('g S')).toBeUndefined();
    expect(ariaShortcut([])).toBeUndefined();
  });
});
