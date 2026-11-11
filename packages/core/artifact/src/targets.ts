/**
 * Targets: where an overview points. Code is `path#L12-L44`, `path#L12` or, from a link, `path`
 * alone; a term is its name; a section is `#anchor`, which `@lo/markdown` resolves. Each is read
 * from the text as written: nothing is percent-decoded, and a path is never made absolute or
 * resolved, only refused when it isn't already in its plain form.
 */

import { LIMITS } from './limits.ts';
import { utf8Length } from './source.ts';
import type { CodeRange, CodeTarget, Lines, TermTarget } from './tree.ts';
import { quote, type FindingCode } from './findings.ts';

/** What reading some text gave: its value, or why it's refused. */
export type Read<T> = { ok: true; value: T } | { ok: false; code: FindingCode; message: string };

function refuse<T>(code: FindingCode, message: string): Read<T> {
  return { ok: false, code, message };
}

/** The link schemes of the format's own targets. */
export const CODE = 'code:';
export const TERM = 'term:';

/** The file types a figure may be, by the ending of its name. */
export const FIGURE_TYPES = ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'] as const;

/**
 * `text` as a path in the repository: relative to its root, with no `.`, `..`, empty or `.git`
 * part, no backslash and no control character. It's kept exactly as written, so it names the file
 * whose path is these bytes and no other.
 */
export function readPath(text: string): Read<string> {
  if (text === '') return refuse('target-path', 'This names no file.');
  const shown = quote(text);
  if (/\p{Cc}/u.test(text)) {
    return refuse('target-path', `The path ${shown} holds a control character.`);
  }
  if (text.startsWith('/')) {
    return refuse(
      'target-path',
      `The path ${shown} starts with /. Write paths from the repository's root, without the /.`,
    );
  }
  if (text.includes('\\')) {
    return refuse('target-path', `The path ${shown} holds a \\. Separate folders with /.`);
  }
  for (const part of text.split('/')) {
    if (part === '' || part === '.' || part === '..') {
      return refuse(
        'target-path',
        `The path ${shown} has an empty, . or .. part. Write it as the repository names the file.`,
      );
    }
    if (part.toLowerCase() === '.git') {
      return refuse('target-path', `The path ${shown} points into .git.`);
    }
  }
  return { ok: true, value: text };
}

/** `text`, after a target's `#`, as lines: `L12` or `L12-L44`, counting from 1. */
export function readLines(text: string): Read<Lines> {
  const match = /^L([1-9][0-9]{0,8})(?:-L([1-9][0-9]{0,8}))?$/.exec(text);
  if (!match) {
    return refuse(
      'target-lines',
      `#${quote(text)} isn't a line or lines. Write #L12 or #L12-L44, counting from 1.`,
    );
  }
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (end < start) {
    return refuse('target-lines', `#${quote(text)} ends before it starts.`);
  }
  return { ok: true, value: { start, end } };
}

/**
 * `text` as code: a path, then `#` and its lines. The last `#` starts the lines, so a path may
 * hold a `#` when lines follow it. A block or a step (`'range'`) needs lines, at most
 * {@link LIMITS.lines} of them; a link (`'any'`) may name the whole file.
 */
export function readCode(text: string, need: 'range'): Read<CodeRange>;
export function readCode(text: string, need: 'any'): Read<CodeTarget>;
export function readCode(text: string, need: 'range' | 'any'): Read<CodeTarget> {
  if (utf8Length(text, LIMITS.argument + 1) > LIMITS.argument) {
    return refuse('target-path', `The target ${quote(text)} is longer than ${bytes()}.`);
  }
  const hash = text.lastIndexOf('#');
  const path = readPath(hash < 0 ? text : text.slice(0, hash));
  if (!path.ok) return path;
  if (hash < 0) {
    if (need === 'any') return { ok: true, value: { kind: 'code', path: path.value } };
    return refuse(
      'target-lines',
      `${quote(text)} needs its lines, such as ${quote(path.value)}#L12-L44.`,
    );
  }
  const lines = readLines(text.slice(hash + 1));
  if (!lines.ok) return lines;
  const count = lines.value.end - lines.value.start + 1;
  if (need === 'range' && count > LIMITS.lines) {
    return refuse(
      'target-lines',
      `${quote(text)} is ${count} lines, and a block shows at most ${LIMITS.lines}. Link the file instead.`,
    );
  }
  return { ok: true, value: { kind: 'code', path: path.value, lines: lines.value } };
}

/**
 * The key a term goes by: its name in lower case, with each run of white space as one space and
 * none at either end. Names that differ only in case or spacing are the same term.
 */
export function termKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** `text`, from a `term:` link or the glossary, as a term. */
export function readTerm(text: string): Read<TermTarget> {
  if (utf8Length(text, LIMITS.argument + 1) > LIMITS.argument) {
    return refuse('target-term', `The term ${quote(text)} is longer than ${bytes()}.`);
  }
  const key = termKey(text);
  if (key === '') return refuse('target-term', 'This names no term.');
  if (/\p{Cc}/u.test(key)) {
    return refuse('target-term', `The term ${quote(text)} holds a control character.`);
  }
  return { ok: true, value: { kind: 'term', key } };
}

/**
 * `text` as a figure's path: `figures/`, then a file's name with one of {@link FIGURE_TYPES}'
 * endings. Figures sit directly in `figures/`, never in a folder inside it.
 */
export function readFigure(text: string): Read<string> {
  const usage = `A figure is an .svg, .png, .jpg, .jpeg, .gif or .webp file in figures/, such as figures/flow.svg.`;
  if (utf8Length(text, LIMITS.argument + 1) > LIMITS.argument) {
    return refuse('figure-path', `The path ${quote(text)} is longer than ${bytes()}.`);
  }
  const path = readPath(text);
  if (!path.ok) return refuse('figure-path', path.message);
  const name = text.startsWith('figures/') ? text.slice('figures/'.length) : '';
  const dot = name.lastIndexOf('.');
  const type = name.slice(dot + 1);
  if (name.includes('/') || dot <= 0 || !FIGURE_TYPES.some((known) => known === type)) {
    return refuse('figure-path', `${quote(text)} isn't a figure. ${usage}`);
  }
  return { ok: true, value: text };
}

/** The limit on an argument, in words. */
export function bytes(): string {
  return `${LIMITS.argument.toLocaleString('en-US')} bytes`;
}
