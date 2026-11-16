// Text from a repository or a language server, set where it's read. Format characters (Unicode's
// category Cf, and the tag characters) take no room and are invisible, yet they change what text
// says: a right-to-left override makes a file named `evil`, U+202E, `slx.txt` read as `eviltxt.xls`,
// and a zero-width space makes `foo` and `fo`, U+200B, `o` two different names. So they're shown,
// each as its code point, and never dropped or swapped for one character that stands for them all.
//
// Names, paths, signatures, symbols and code show every one. Prose, which real scripts and emoji
// write with a few of them, keeps those and shows the rest.

/** Every format character, and the tag characters (which are mostly format characters too). */
const FORMAT = /[\p{Cf}\u{E0000}-\u{E007F}]/gu;

/**
 * The format characters prose needs and may keep: the direction marks that right-to-left scripts
 * write with (LRM, RLM and the Arabic letter mark), and the joiners that shape Indic, Arabic and
 * emoji sequences (ZWNJ and ZWJ). The explicit embeddings, overrides and isolates are not among
 * them: they reorder text around them, and prose has no use for them that code doesn't.
 */
const PROSE_KEEPS = new Set(['‎', '‏', '؜', '‌', '‍']);

/** What a few format characters are called, for the title of the mark that shows them. */
const NAMES: Readonly<Record<string, string>> = {
  '­': 'soft hyphen',
  '؜': 'arabic letter mark',
  '᠎': 'mongolian vowel separator',
  '​': 'zero width space',
  '‌': 'zero width non-joiner',
  '‍': 'zero width joiner',
  '‎': 'left-to-right mark',
  '‏': 'right-to-left mark',
  '‪': 'left-to-right embedding',
  '‫': 'right-to-left embedding',
  '‬': 'pop directional formatting',
  '‭': 'left-to-right override',
  '‮': 'right-to-left override',
  '⁠': 'word joiner',
  '⁡': 'function application',
  '⁢': 'invisible times',
  '⁣': 'invisible separator',
  '⁤': 'invisible plus',
  '⁦': 'left-to-right isolate',
  '⁧': 'right-to-left isolate',
  '⁨': 'first strong isolate',
  '⁩': 'pop directional isolate',
  '﻿': 'zero width no-break space',
};

/** A format character shown as what it is. */
export interface FormatMark {
  /** Its code point, as Unicode writes it: `U+202E`. */
  code: string;
  /** What it's called, when it's one of those that are common. */
  name: string | undefined;
}

/** `char`'s code point as Unicode writes it: at least four hex digits, in capitals. */
function codeOf(char: string): string {
  const point = char.codePointAt(0) ?? 0;
  return `U+${point.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * `text` as its plain stretches and the format characters between them, in order, so a renderer
 * can draw each mark as it likes. Joining the stretches with the marks' characters gives `text`
 * again. In `prose`, the characters that prose keeps stay in the stretches.
 */
export function splitFormat(text: string, prose = false): (string | FormatMark)[] {
  const pieces: (string | FormatMark)[] = [];
  let from = 0;
  for (const found of text.matchAll(FORMAT)) {
    const char = found[0];
    if (prose && PROSE_KEEPS.has(char)) continue;
    if (found.index > from) pieces.push(text.slice(from, found.index));
    pieces.push({ code: codeOf(char), name: NAMES[char] });
    from = found.index + char.length;
  }
  if (from < text.length) pieces.push(text.slice(from));
  return pieces;
}

/** The title of a mark: its code point, and its name when it has one. */
export function markTitle(mark: FormatMark): string {
  return mark.name === undefined ? mark.code : `${mark.code} ${mark.name}`;
}

/**
 * `text` as one string, each format character written out as `‹U+202E›`: for what can't hold a
 * mark of its own, such as a label for a screen reader or a tooltip.
 */
export function showFormat(text: string): string {
  return splitFormat(text)
    .map((piece) => (typeof piece === 'string' ? piece : `‹${piece.code}›`))
    .join('');
}

/** Whether `text` holds a format character that shows, as prose or as a name. */
export function hasFormat(text: string, prose = false): boolean {
  return splitFormat(text, prose).some((piece) => typeof piece !== 'string');
}

/**
 * `text` as one string, as prose reads it: the format characters prose keeps are left as they are,
 * and the rest are written out as `‹U+202E›`. For prose that can't hold a mark of its own.
 */
export function showProse(text: string): string {
  return splitFormat(text, true)
    .map((piece) => (typeof piece === 'string' ? piece : `\u2039${piece.code}\u203A`))
    .join('');
}

/**
 * `text` without the characters that turn the direction of the text after them around until
 * they're closed (embeddings, overrides and isolates), which a pull request's author could use to
 * make a title, a login or a branch's name read as something else. The marks right-to-left text
 * places numbers and punctuation with (LRM, RLM, ALM) stay: they change no more than their
 * neighbours. For what a row or a status says of a pull request, which is drawn as a line of text
 * and has no room for a mark of each.
 */
export function withoutBidi(text: string): string {
  return text.replaceAll(/[‪-‮⁦-⁩]/g, '');
}
