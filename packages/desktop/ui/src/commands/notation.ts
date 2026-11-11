// Lo's key notation, the one way keys are written, in declarations and in the keymap file, and the
// forms each system shows them in.
//
// - A chord joins modifiers and a key with `+`: `cmd+shift+p`. `cmd` is ⌘ on macOS and Ctrl on
//   Linux, `ctrl` is ⌃ on both, `alt` is ⌥ and `shift` is ⇧.
// - A sequence separates its keys with spaces: `] f`, `g S`.
// - A key is one character, or one of `keyNames` (`enter`, `esc`, `tab`, `space`, `up`, `f1`…),
//   with `plus` for `+`. Letters and modifier names may be written in any case, but a lone
//   letter's case is the key: `G` is Shift and g, and so is `shift+g`.

/** The systems Lo runs on. */
export type System = 'mac' | 'linux';

/** One key of a sequence as written: a key and the modifiers held with it. */
export interface Chord {
  /** A character, or one of `keyNames`. */
  readonly key: string;
  /** ⌘ on macOS, Ctrl on Linux. */
  readonly cmd: boolean;
  /** ⌃ on both. */
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/** Keys pressed one after another, as written. */
export type Sequence = readonly Chord[];

/**
 * One keystroke as a system sends it, which is what matching compares. A character typed without
 * ⌘, Ctrl or ⌥ carries its Shift (`G`, `?`), so `shift` is false for it. With one of those held,
 * a letter is lowercase and a symbol unshifted, as on a US keyboard, and Shift is a modifier of
 * its own: ⌘⇧] is `meta+shift+]`.
 */
export interface Stroke {
  /** The stroke as text, for comparing: `meta+shift+p`, `ctrl+o`, `]`, `G`, `shift+tab`. */
  readonly id: string;
  readonly key: string;
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

const modifiers = ['cmd', 'ctrl', 'alt', 'shift'] as const;
type Modifier = (typeof modifiers)[number];

/** The keys written by name, as they're written. */
export const keyNames: readonly string[] = [
  'enter',
  'esc',
  'tab',
  'space',
  'backspace',
  'delete',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'insert',
  'menu',
  ...Array.from({ length: 20 }, (_, index) => `f${index + 1}`),
];
const names = new Set(keyNames);

/** `event.key`'s names for the keys Lo names. */
const eventNames: Readonly<Record<string, string>> = {
  Enter: 'enter',
  Escape: 'esc',
  Tab: 'tab',
  ' ': 'space',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Insert: 'insert',
  ContextMenu: 'menu',
  ...Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`F${index + 1}`, `f${index + 1}`]),
  ),
};

/** Keys that are never a keystroke of their own. */
const modifierKeys = new Set([
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Fn',
  'FnLock',
  'Hyper',
  'Meta',
  'NumLock',
  'OS',
  'ScrollLock',
  'Shift',
  'Super',
  'Symbol',
  'SymbolLock',
]);

/** Each symbol on a US keyboard and the one Shift gives on the same key. */
const shiftedSymbols: Readonly<Record<string, string>> = {
  '`': '~',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
};
const unshiftedSymbols: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(shiftedSymbols).map(([base, shifted]) => [shifted, base]),
);

/** The unshifted key on a US keyboard at each `event.code` that types a character. */
const codeKeys: Readonly<Record<string, string>> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'space',
};

/** Whether `key` is one character (one code point), rather than a key's name. */
function isCharacter(key: string): boolean {
  return /^.$/su.test(key);
}

/** `key` as Shift types it, for a character typed on its own. */
function shiftedForm(key: string): string {
  const upper = key.toUpperCase();
  if (upper !== key && isCharacter(upper)) return upper;
  return shiftedSymbols[key] ?? key;
}

/** `key` without Shift, and whether that took Shift away. */
function unshiftedForm(key: string): { key: string; shift: boolean } {
  const lower = key.toLowerCase();
  if (lower !== key && isCharacter(lower)) return { key: lower, shift: true };
  const base = unshiftedSymbols[key];
  return base === undefined ? { key, shift: false } : { key: base, shift: true };
}

/** The stroke for `key` with these modifiers, normalized as `Stroke` says. */
export function strokeOf(
  key: string,
  held: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
): Stroke {
  const meta = held.meta ?? false;
  const ctrl = held.ctrl ?? false;
  const alt = held.alt ?? false;
  let shift = held.shift ?? false;
  if (isCharacter(key)) {
    if (!meta && !ctrl && !alt) {
      if (shift) key = shiftedForm(key);
      shift = false;
    } else {
      const base = unshiftedForm(key);
      key = base.key;
      shift ||= base.shift;
    }
  }
  const id = `${meta ? 'meta+' : ''}${ctrl ? 'ctrl+' : ''}${alt ? 'alt+' : ''}${shift ? 'shift+' : ''}${key}`;
  return { id, key, meta, ctrl, alt, shift };
}

/** Whether `key` holds ⌘, Ctrl or ⌥: a chord, rather than a key that could be typed. */
export function isChord(key: Stroke): boolean {
  return key.meta || key.ctrl || key.alt;
}

/** Keys a text field takes, with or without Shift: characters and moving through the text. */
const textNames = new Set(['space', 'backspace', 'delete', 'left', 'right', 'home', 'end']);

/** Whether a text field outside a code view takes `key`: typing, or moving through the text. */
export function isTyping(key: Stroke): boolean {
  return !isChord(key) && (isCharacter(key.key) || textNames.has(key.key));
}

/** The parts of a key event `eventStroke` reads. */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  getModifierState?(key: string): boolean;
}

/**
 * What each key types on its own on the keyboard's layout, by `event.code`, as
 * `navigator.keyboard.getLayoutMap()` gives it. Without it, keys are taken to be where a US
 * keyboard has them.
 */
export interface Layout {
  get(code: string): string | undefined;
}

/** What reading a key event needs besides the event: the system, and the layout if it's known. */
export interface Reading {
  readonly system: System;
  /** What each key types on its own. Without it, keys are where a US keyboard has them. */
  readonly layout?: Layout | undefined;
}

/**
 * The strokes a keydown event can be, the likelier first: none for a modifier key on its own, a
 * dead key on its own (the start of an accent), or a key the system didn't identify. Keyboard
 * layouts differ, so:
 *
 * - With ⌘ or Ctrl, a letter outside A to Z (Russian з where P is) or a symbol outside ASCII is read
 *   by its place, `event.code`, so Ctrl+P is Ctrl+P on any layout. A symbol with Shift is read by
 *   its place too, since systems disagree on whether `event.key` is shifted then. Linux's Alt is
 *   read the same way: it types nothing there (AltGr does), so `event.key` is the key's own.
 * - On macOS, ⌥ types characters: German types `]` with ⌥6, a US Mac types å with ⌥A. When
 *   `event.key` differs from what the key types on its own, that character comes first, so `] b`
 *   works on German, and ⌥ with the key comes second, so a binding such as `alt+a` still matches.
 *   When it doesn't differ, as with a US Mac's ⌥⇧`, it's only ⌥ with the key. With ⌘ or Ctrl as
 *   well, or a dead key (⌥E), it's only the key, by the layout.
 * - A dead key on its own matches nothing, so composing an accent goes on: which character it
 *   starts differs from layout to layout (`^` where US has `` ` `` on German).
 */
export function eventStrokes(event: KeyEventLike, reading: Reading): readonly Stroke[] {
  const { key, code } = event;
  if (modifierKeys.has(key) || key === 'Unidentified' || key === 'Process') return [];
  // AltGr types characters: what it gives is text, not a chord.
  const altGraph = event.getModifierState?.('AltGraph') ?? false;
  const meta = event.metaKey;
  const ctrl = event.ctrlKey && !altGraph;
  const alt = event.altKey && !altGraph;
  const shift = event.shiftKey;
  const named = eventNames[key];
  if (named !== undefined) return [strokeOf(named, { meta, ctrl, alt, shift })];
  const dead = key === 'Dead';
  if (!meta && !ctrl && !alt) return !dead && isCharacter(key) ? [strokeOf(key)] : [];
  /** macOS's ⌥, which changes `event.key`. */
  const option = alt && reading.system === 'mac';
  /** What the key types on its own, on this layout if it's known. */
  const own = ownKey(reading.layout, code);
  /** The key as a chord reads it: its own character in ASCII, or else its US place. */
  const place = own !== undefined && /^[!-~]$/.test(own) ? own : codeKey(code);
  if (option && !meta && !ctrl) {
    const chord = place === undefined ? [] : [strokeOf(place, { alt, shift })];
    const changed = !dead && isPrintable(key) && (own === undefined || !typesAlike(key, own));
    return changed ? [strokeOf(key), ...chord] : chord;
  }
  let base: string | undefined;
  if (option || dead) base = place;
  else if (/^[a-z]$/i.test(key)) base = key.toLowerCase();
  else if (/^[!-~]$/.test(key)) base = shift ? (codeKey(code) ?? unshiftedForm(key).key) : key;
  else base = codeKey(code) ?? (isCharacter(key) ? key.toLowerCase() : undefined);
  return base === undefined ? [] : [strokeOf(base, { meta, ctrl, alt, shift })];
}

/**
 * Whether a key pressed on its own disagrees with what `layout` (or, without one, a US keyboard)
 * says it types: the layout has changed since it was read. Only keys the layout can speak for
 * count: a character without ⌘, Ctrl, ⌥ or AltGr, and with Shift only a letter.
 */
export function contradicts(layout: Layout | undefined, event: KeyEventLike): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.getModifierState?.('AltGraph') ?? false) return false;
  const { key } = event;
  if (key === 'Dead' || !isCharacter(key) || key === ' ') return false;
  const lower = key.toLowerCase();
  if (event.shiftKey && lower === key.toUpperCase()) return false;
  const own = ownKey(layout, event.code);
  return own !== undefined && own !== lower;
}

/** What the key at `code` types on its own: on `layout` if it knows, or on a US keyboard. */
function ownKey(layout: Layout | undefined, code: string): string | undefined {
  const typed = layout?.get(code);
  if (typed !== undefined && isCharacter(typed)) return typed.toLowerCase();
  const us = codeKey(code);
  return us === 'space' ? undefined : us;
}

/** Whether `typed` is what the key that types `own` on its own types, with or without Shift. */
function typesAlike(typed: string, own: string): boolean {
  return (
    typed === own || typed.toLowerCase() === own.toLowerCase() || shiftedSymbols[own] === typed
  );
}

/** The likeliest stroke a keydown event is, as `eventStrokes` reads it. */
export function eventStroke(event: KeyEventLike, reading: Reading): Stroke | undefined {
  return eventStrokes(event, reading)[0];
}

/** Whether `key` is one character that shows: not a space or a control character. */
function isPrintable(key: string): boolean {
  return /^[^\s\p{C}]$/u.test(key);
}

/** The unshifted key at `code` on a US keyboard, if it types one. */
function codeKey(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return codeKeys[code];
}

/** Keys written in Lo's notation, or why they can't be read. */
export function readKeys(text: string): { keys: Sequence } | { error: string } {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return { error: 'No keys.' };
  const keys: Chord[] = [];
  for (const word of words) {
    const chord = readChord(word);
    if ('error' in chord) return chord;
    keys.push(chord);
  }
  return { keys };
}

/** Keys written in Lo's notation. Throws if they can't be read. */
export function parseKeys(text: string): Sequence {
  const read = readKeys(text);
  if ('error' in read) throw new Error(`Keys "${text}": ${read.error}`);
  return read.keys;
}

function readChord(word: string): Chord | { error: string } {
  let parts: string[];
  let key: string;
  if (word === '+') {
    parts = [];
    key = '+';
  } else if (word.endsWith('++')) {
    parts = word.slice(0, -2).split('+');
    key = '+';
  } else {
    parts = word.split('+');
    key = parts.pop() ?? '';
    if (key === '') return { error: `"${word}" has no key after its last "+".` };
  }
  const held = new Set<Modifier>();
  for (const part of parts) {
    const modifier = modifiers.find((name) => name === part.toLowerCase());
    if (modifier === undefined) {
      return part === ''
        ? { error: `"${word}" has a "+" with nothing before it.` }
        : { error: `"${part}" in "${word}" isn't a modifier: use cmd, ctrl, alt or shift.` };
    }
    if (held.has(modifier)) return { error: `"${word}" holds ${modifier} twice.` };
    held.add(modifier);
  }
  if (!isCharacter(key)) {
    const name = key.toLowerCase();
    if (name === 'plus') key = '+';
    else if (names.has(name)) key = name;
    else return { error: `"${key}" isn't a key: write one character, or a name such as enter.` };
  }
  return normalizeChord({
    key,
    cmd: held.has('cmd'),
    ctrl: held.has('ctrl'),
    alt: held.has('alt'),
    shift: held.has('shift'),
  });
}

/** `chord` in the one form each keystroke has, as `Stroke` normalizes. */
function normalizeChord(chord: Chord): Chord {
  const resolved = strokeOf(chord.key, {
    meta: chord.cmd,
    ctrl: chord.ctrl,
    alt: chord.alt,
    shift: chord.shift,
  });
  return { ...chord, key: resolved.key, shift: resolved.shift };
}

/** `sequence` written in Lo's notation, as the keymap file takes it. */
export function writeKeys(sequence: Sequence): string {
  return sequence
    .map((chord) => {
      const held = modifiers.filter((modifier) => chord[modifier]);
      const key = chord.key === '+' ? 'plus' : chord.key;
      return [...held, key].join('+');
    })
    .join(' ');
}

/** Strokes on `system` written in Lo's notation: ⌘ as `cmd` on macOS, Ctrl as `ctrl`. */
export function writeStrokes(strokes: readonly Stroke[], system: System): string {
  return writeKeys(
    strokes.map((each) => ({
      key: each.key,
      cmd: each.meta && system === 'mac',
      ctrl: each.ctrl,
      alt: each.alt,
      shift: each.shift,
    })),
  );
}

/** The strokes `sequence` is on `system`: `cmd` is ⌘ (meta) on macOS and Ctrl on Linux. */
export function systemStrokes(sequence: Sequence, system: System): readonly Stroke[] {
  return sequence.map((chord) =>
    strokeOf(chord.key, {
      meta: chord.cmd && system === 'mac',
      ctrl: chord.ctrl || (chord.cmd && system === 'linux'),
      alt: chord.alt,
      shift: chord.shift,
    }),
  );
}

/** How macOS shows the keys Lo names. */
const macNames: Readonly<Record<string, string>> = {
  enter: '⏎',
  esc: 'Esc',
  space: 'Space',
  backspace: '⌫',
  delete: '⌦',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  insert: 'Ins',
  menu: 'Menu',
};

/** How Linux shows them. */
const linuxNames: Readonly<Record<string, string>> = {
  enter: 'Enter',
  esc: 'Esc',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  insert: 'Insert',
  menu: 'Menu',
};

/**
 * How `system` shows one keystroke. macOS joins symbols with no separator: `⌘⇧P`, `⌃o`, `⌥⏎`,
 * `⌃⇧⇥`, `⇧Tab`. A letter is a capital with ⌘, ⌥ or ⇧, as in macOS's menus, and stays lowercase
 * on its own or with ⌃ alone, as Vim's keys are written (`⌃o`). Linux spells modifiers out and
 * joins them with `+`: `Ctrl+Shift+P`, `Ctrl+O`, `Alt+Enter`.
 */
export function strokeLabel(stroke: Stroke, system: System): string {
  const { key } = stroke;
  if (system === 'mac') {
    const held = `${stroke.meta ? '⌘' : ''}${stroke.ctrl ? '⌃' : ''}${stroke.alt ? '⌥' : ''}${stroke.shift ? '⇧' : ''}`;
    let label: string;
    if (key === 'tab') label = isChord(stroke) ? '⇥' : 'Tab';
    else if (isCharacter(key))
      label = stroke.meta || stroke.alt || stroke.shift ? key.toUpperCase() : key;
    else label = macNames[key] ?? key.toUpperCase();
    return held + label;
  }
  const held = [
    ...(stroke.meta ? ['Super'] : []),
    ...(stroke.ctrl ? ['Ctrl'] : []),
    ...(stroke.alt ? ['Alt'] : []),
    ...(stroke.shift ? ['Shift'] : []),
  ];
  let label: string;
  if (isCharacter(key)) label = held.length > 0 ? (key === '+' ? 'Plus' : key.toUpperCase()) : key;
  else label = linuxNames[key] ?? key.toUpperCase();
  return [...held, label].join('+');
}

/** How `system` shows a sequence: one label per key, as the `Key` component draws each. */
export function keyLabels(strokes: readonly Stroke[], system: System): string[] {
  return strokes.map((each) => strokeLabel(each, system));
}

/** The names `aria-keyshortcuts` gives the keys Lo names, as `KeyboardEvent.key` has them. */
const ariaNames: Readonly<Record<string, string>> = {
  esc: 'Escape',
  space: 'Space',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  menu: 'ContextMenu',
  '+': 'Plus',
};

/**
 * One key as `aria-keyshortcuts` writes it: `Meta+Shift+P`, `Control+O`, `Enter`, `?`. A character
 * with a modifier is a capital, as in the menus' own labels.
 */
function ariaKey(stroke: Stroke): string {
  const { key } = stroke;
  const held = [
    ...(stroke.meta ? ['Meta'] : []),
    ...(stroke.ctrl ? ['Control'] : []),
    ...(stroke.alt ? ['Alt'] : []),
    ...(stroke.shift ? ['Shift'] : []),
  ];
  let name = ariaNames[key];
  if (name === undefined) {
    if (isCharacter(key)) name = held.length > 0 ? key.toUpperCase() : key;
    else name = `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`;
  }
  return [...held, name].join('+');
}

/**
 * A key as `aria-keyshortcuts` says it, so a control can tell a screen reader its key without the
 * key caps being read out. A sequence has none: the attribute's spaces separate alternatives.
 */
export function ariaShortcut(strokes: readonly Stroke[]): string | undefined {
  const [only, ...rest] = strokes;
  return only !== undefined && rest.length === 0 ? ariaKey(only) : undefined;
}

/** Vim's names for the keys Lo names. */
const vimNames: Readonly<Record<string, string>> = {
  enter: 'CR',
  esc: 'Esc',
  tab: 'Tab',
  space: 'Space',
  backspace: 'BS',
  delete: 'Del',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
  menu: 'Menu',
  ...Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`f${index + 1}`, `F${index + 1}`]),
  ),
};

/** One keystroke in Vim's key notation, as a code view hands it to Vim: `g`, `<C-o>`, `<CR>`. */
export function vimKey(stroke: Stroke): string {
  const named = vimNames[stroke.key];
  const key = named ?? (stroke.key === '<' ? 'lt' : stroke.key);
  const held = `${stroke.meta ? 'D-' : ''}${stroke.ctrl ? 'C-' : ''}${stroke.alt ? 'A-' : ''}${stroke.shift ? 'S-' : ''}`;
  if (held === '' && named === undefined) return stroke.key === '<' ? '<lt>' : stroke.key;
  return `<${held}${key}>`;
}

/** A sequence in Vim's key notation: `]f`, `gS`, `<C-w>j`. */
export function vimKeys(strokes: readonly Stroke[]): string {
  return strokes.map(vimKey).join('');
}
