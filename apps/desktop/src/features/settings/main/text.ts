// The settings file's text: JSON with comments, as editors' settings files are, read into the
// settings it holds and changed in place. Nothing here touches the disk.
//
// The file is the person's own, so Lo changes it as a person would by hand: a setting's value is
// replaced where it is, or the setting added after the last one, and every comment, key, space and
// line break around it stays as it was. Before handing the new text on, Lo reads it back and checks
// it says exactly what was meant, so a change never leaves the file meaning anything but what
// Settings shows. A key given twice is read as the last one says, as JavaScript reads JSON; Lo
// won't change it, since the file then says one thing where a person may read another. A byte
// order mark, which some editors write first, is kept. Lo writes no header of its own, and takes
// out the one older versions wrote, which says what Lo no longer does.

import { isDeepStrictEqual } from 'node:util';

import {
  applyEdits,
  createScanner,
  parseTree,
  printParseErrorCode,
  type Edit,
  type Node,
  type ParseError,
} from 'jsonc-parser';

import type { SettingsState } from '../contract.ts';

/** A value as JSON holds it, which is all a setting's value can be. */
type Json = SettingsState['values'][string];

/** What the settings file's text says. */
export type Parsed =
  /**
   * The file's object: one entry for each key in it, whether or not any feature knows it, the text
   * it was read from, and the keys it gives more than once.
   */
  | {
      readonly kind: 'ok';
      readonly values: Readonly<Record<string, unknown>>;
      readonly text: string;
      readonly repeated: readonly string[];
    }
  /** The file can't be used, and why. */
  | ({ readonly kind: 'problem' } & FileProblem);

/**
 * What's wrong with the file, for the person who wrote it, each part in a sentence, where what's
 * between backticks is code: `problem`, the line Settings gives it among the file's problems;
 * `reason`, why a change to a setting wasn't made; `details`, the parser's own words, when it has
 * some; and `cause`, what's wrong in plain words, for what says what to do in its own words.
 */
export interface FileProblem {
  readonly problem: string;
  readonly reason: string;
  readonly details?: string;
  readonly cause: string;
}

/** How the file is read: as JSON, with comments and a comma after the last entry allowed. */
const OPTIONS = { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true };

/**
 * The most levels of objects and lists Lo reads, the file's own object among them: far more than
 * any setting needs, and few enough that reading, checking and comparing values never run out of
 * stack. A file nested deeper is left unread.
 */
export const SETTINGS_DEPTH_LIMIT = 100;

/** The byte order mark some editors start a file with, which Lo reads past and keeps. */
const BOM = '\uFEFF';

/**
 * Headers older versions of Lo wrote at the top of a settings file they made, each exactly as
 * written. They said which settings Lo applied, which is no longer so, and a new file has no
 * header, so a change Lo makes to a file that starts with one takes it out. A header a person
 * wrote, or changed even by a word, isn't one of these and stays.
 */
const RETIRED_HEADERS = [
  `// Lo's settings. Lo applies only these from this file and ignores the rest: "theme",
// "ui_font_family", "ui_font_size", "buffer_font_family" and "buffer_font_size".
// A theme's file goes in ~/.config/lo/themes, and "theme" names it. Lo's README says more.
`,
];

/** `text` without the retired header it starts with, in either kind of line break, if it does. */
function withoutRetiredHeader(text: string): string {
  for (const header of RETIRED_HEADERS) {
    for (const eol of ['\n', '\r\n']) {
      const lines = header.replaceAll('\n', eol);
      if (text.startsWith(lines)) return text.slice(lines.length);
    }
  }
  return text;
}

/**
 * A change Lo couldn't make to the file's text, and why, in words for the person, to follow
 * "Lo didn't change theme: ".
 */
export class SettingsUneditable extends Error {
  override name = 'SettingsUneditable';
}

/** The file's object, as a tree to edit and as values, or what's wrong with it. */
type Tree =
  | {
      readonly ok: true;
      /** None when the file holds no value: nothing, or only comments. */
      readonly root: Node | undefined;
      readonly values: Readonly<Record<string, unknown>>;
      readonly repeated: readonly string[];
    }
  | ({ readonly ok: false } & FileProblem);

/** A problem with the file, said the same way as a line and as a reason. */
function wrong(problem: string, cause: string): Tree {
  return { ok: false, problem, reason: problem, cause };
}

/** Reads `text`, a file's without its byte order mark, as the settings file. */
function read(text: string): Tree {
  if (tooDeep(text)) {
    return wrong(
      `\`settings.json\` nests over ${SETTINGS_DEPTH_LIMIT} levels deep.`,
      `The settings file nests objects and lists over ${SETTINGS_DEPTH_LIMIT} levels deep.`,
    );
  }
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, OPTIONS);
  const first = errors[0];
  if (first) {
    const { line, column } = place(first, text);
    return {
      ok: false,
      problem: `Line ${line}, column ${column} isn’t valid JSON.`,
      reason: '`settings.json` isn’t valid JSON.',
      details: `${printParseErrorCode(first.error)} at line ${line}, column ${column}`,
      cause: `The settings file isn't valid JSON (${what(first)} at line ${line}, column ${column}).`,
    };
  }
  if (root === undefined) return { ok: true, root, values: {}, repeated: [] };
  if (root.type !== 'object') {
    return wrong(
      '`settings.json` isn’t a JSON object.',
      'The settings file should hold one JSON object, such as { "theme": "dark" }.',
    );
  }
  const pairs = entries(root);
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const [key] of pairs) {
    if (seen.has(key)) repeated.add(key);
    seen.add(key);
  }
  return { ok: true, root, values: Object.fromEntries(pairs), repeated: [...repeated] };
}

/**
 * Whether `text` nests objects and lists past the limit, found by counting brackets token by
 * token, since the parser, like everything that reads a value after it, calls itself for each
 * level and would run out of stack first.
 */
function tooDeep(text: string): boolean {
  // Comments are skipped, and a string is one token, so brackets in either aren't counted.
  const scanner = createScanner(text, true);
  let depth = 0;
  for (;;) {
    scanner.scan();
    const offset = scanner.getTokenOffset();
    if (offset >= text.length) return false;
    const bracket = text[offset];
    if (bracket === '{' || bracket === '[') {
      depth += 1;
      if (depth > SETTINGS_DEPTH_LIMIT) return true;
    } else if (bracket === '}' || bracket === ']') {
      depth -= 1;
    }
  }
}

/** An object's keys and values, in the order the text gives them, each key as often as it does. */
function entries(object: Node): [string, unknown][] {
  return (object.children ?? []).flatMap((property): [string, unknown][] => {
    const [name, value] = property.children ?? [];
    return name && value ? [[String(name.value), valueOf(value)]] : [];
  });
}

/** What `node` holds, as `JSON.parse` would make it. */
function valueOf(node: Node): unknown {
  const kind = node.type;
  switch (kind) {
    case 'object':
      // A key given twice has its last value, and `__proto__` is a key like any other.
      return Object.fromEntries(entries(node));
    case 'array':
      return (node.children ?? []).map(valueOf);
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
      return node.value;
    case 'property':
      // Only an object's children are properties, and `entries` reads those.
      return undefined;
    default:
      kind satisfies never;
      return undefined;
  }
}

/** Where `error` is in `text`, by line and column, each counted from 1. */
function place(error: ParseError, text: string): { line: number; column: number } {
  const before = text.slice(0, error.offset);
  const line = (before.match(/\n/g)?.length ?? 0) + 1;
  return { line, column: before.length - before.lastIndexOf('\n') };
}

/** What `error` is, in words: "Lo expected a comma". */
function what(error: ParseError): string {
  const code = printParseErrorCode(error.error);
  switch (code) {
    case 'InvalidSymbol':
      return "Lo found something JSON doesn't have";
    case 'InvalidNumberFormat':
      return "a number isn't written as JSON writes one";
    case 'PropertyNameExpected':
      return 'Lo expected a key in double quotes';
    case 'ValueExpected':
      return 'Lo expected a value';
    case 'ColonExpected':
      return 'Lo expected a colon';
    case 'CommaExpected':
      return 'Lo expected a comma';
    case 'CloseBraceExpected':
      return 'Lo expected a closing }';
    case 'CloseBracketExpected':
      return 'Lo expected a closing ]';
    case 'EndOfFileExpected':
      return 'Lo expected nothing more after the object';
    case 'UnexpectedEndOfComment':
      return "a /* comment isn't closed";
    case 'UnexpectedEndOfString':
      return "a string isn't closed";
    case 'UnexpectedEndOfNumber':
      return 'a number ends too soon';
    case 'InvalidUnicode':
      return "a \\u escape isn't four hex digits";
    case 'InvalidEscapeCharacter':
      return "a string has a \\ escape JSON doesn't";
    case 'InvalidCharacter':
      return 'a string holds a tab or another control character, which JSON writes escaped';
    case 'InvalidCommentToken':
    case '<unknown ParseErrorCode>':
      return "Lo found something it can't read";
    default:
      code satisfies never;
      return "Lo found something it can't read";
  }
}

/**
 * The settings in `text`: one JSON object, or nothing at all (a file with only white space or
 * comments is no settings), with comments and trailing commas allowed. Anything else is a problem
 * that says what was wrong, and where.
 */
export function parseSettings(text: string): Parsed {
  const tree = read(text.startsWith(BOM) ? text.slice(1) : text);
  if (!tree.ok) {
    const { problem, reason, details, cause } = tree;
    return {
      kind: 'problem',
      problem,
      reason,
      cause,
      ...(details === undefined ? {} : { details }),
    };
  }
  return { kind: 'ok', values: tree.values, text, repeated: tree.repeated };
}

/** The white space before `offset` on its line, or none when something else comes before it. */
function leading(text: string, offset: number): string | undefined {
  const before = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
  return /^[ \t]*$/.test(before) ? before : undefined;
}

/**
 * `value` as JSON: over lines a `step` deeper each, from `indent`, the white space its line
 * starts with; or on one line, where it shares its line with more than white space (no `indent`).
 */
function json(value: Json, step: string, indent: string | undefined, eol: string): string {
  if (indent === undefined) return JSON.stringify(value);
  return JSON.stringify(value, null, step).replaceAll('\n', `${eol}${indent}`);
}

/**
 * `text`, a settings file that reads without a problem, with `key` set to `value`, changed as a
 * person would by hand. A key the file has keeps its place, and only its value changes. A new one
 * goes after the last key, on a line of its own in the file's indent (two spaces when the file has
 * none), with a comma after it if the last had one; in an object on one line, it goes on that line.
 * Everything else stays as it was, a byte order mark included, but for a header an older Lo wrote,
 * which goes (see {@link RETIRED_HEADERS}). Throws {@link SettingsUneditable}
 * for a file it can't read, a key the file has more than once, or a change that would leave the
 * file saying anything but what it did with `key` set to `value`.
 */
export function editSettings(text: string, key: string, value: Json): string {
  if (text.startsWith(BOM)) return `${BOM}${editSettings(text.slice(1), key, value)}`;
  const tree = read(text);
  if (!tree.ok) throw new SettingsUneditable('the settings file has a problem');
  if (tree.repeated.includes(key)) {
    throw new SettingsUneditable('the settings file has it more than once');
  }
  const { root } = tree;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const properties = root?.children ?? [];
  const step =
    properties
      .map((property) => leading(text, property.offset))
      .find((indent) => indent !== undefined) ?? '  ';
  const entry = (indent: string | undefined) =>
    `${JSON.stringify(key)}: ${json(value, step, indent, eol)}`;
  let edits: Edit[];
  if (root === undefined) {
    // No object yet: one in place of white space, or after the comments.
    const object = `{${eol}${step}${entry(step)}${eol}}${eol}`;
    edits =
      text.trim() === ''
        ? [{ offset: 0, length: text.length, content: object }]
        : [
            {
              offset: text.length,
              length: 0,
              content: `${text.endsWith('\n') ? '' : eol}${object}`,
            },
          ];
  } else {
    const property = properties.find((each) => each.children?.[0]?.value === key);
    const found = property?.children?.[1];
    edits =
      property && found
        ? [
            {
              offset: found.offset,
              length: found.length,
              content: json(value, step, leading(text, property.offset), eol),
            },
          ]
        : added(text, root, entry, step, eol);
  }
  // The edits are all past the file's start, so the header is still there to take out.
  const changed = withoutRetiredHeader(applyEdits(text, edits));
  const after = read(changed);
  // Through JSON, as the file holds it: -0 is 0 there.
  const meant: unknown = { ...tree.values, [key]: JSON.parse(JSON.stringify(value)) };
  if (
    !after.ok ||
    !isDeepStrictEqual(after.values, meant) ||
    !isDeepStrictEqual(after.repeated, tree.repeated)
  ) {
    throw new SettingsUneditable(
      "the new value, written into the settings file, wouldn't read back as Settings shows it, so Lo left the file as it was",
    );
  }
  return changed;
}

/** The edits that add a key, as `entry` writes it at an indent, after the object's last. */
function added(
  text: string,
  root: Node,
  entry: (indent: string | undefined) => string,
  step: string,
  eol: string,
): Edit[] {
  const close = root.offset + root.length - 1;
  const last = root.children?.at(-1);
  const end = last ? last.offset + last.length : root.offset + 1;
  // The offset after a comma that follows the last key, past any comments, if one does.
  let comma: number | undefined;
  if (last) {
    const scanner = createScanner(text, true);
    scanner.setPosition(end);
    scanner.scan();
    if (text[scanner.getTokenOffset()] === ',') comma = scanner.getPosition();
  }
  if (leading(text, close) !== undefined) {
    // The closing brace is on a line of its own: the key goes on one just above it.
    const line = text.lastIndexOf('\n', close - 1) + 1;
    const edits = [
      {
        offset: line,
        length: 0,
        content: `${step}${entry(step)}${comma === undefined ? '' : ','}${eol}`,
      },
    ];
    if (last && comma === undefined) edits.push({ offset: end, length: 0, content: ',' });
    return edits;
  }
  if (!last) {
    // `{}`: the key on a line of its own between the braces.
    const inside = text.slice(root.offset + 1, close);
    const space = inside.length - inside.trimEnd().length;
    return [{ offset: close - space, length: space, content: `${eol}${step}${entry(step)}${eol}` }];
  }
  // An object on one line stays on one.
  return comma === undefined
    ? [{ offset: end, length: 0, content: `, ${entry(undefined)}` }]
    : [{ offset: comma, length: 0, content: ` ${entry(undefined)},` }];
}
