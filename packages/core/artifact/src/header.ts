/**
 * The header: the first lines of `artifact.md`, from a line of `---` to the next, holding
 * `format`, `pr` and `commit`, each once, and nothing else. It's read by hand, not as YAML, so
 * there are no aliases, tags or types to guard against for three plain values.
 */

import { quote, type FindingCode, type Findings } from './findings.ts';
import { FORMAT } from './limits.ts';

export interface Header {
  /** The format the overview is written in. */
  format: number;
  /** The pull request it describes. */
  pr: number;
  /** The full id of the commit it describes: 40 hexadecimal digits, or 64 in a SHA-256 repository. */
  commit: string;
}

export interface HeaderRead {
  /** The header, when it holds its three keys, each valid. */
  header?: Header;
  /** The format it names, when that's a whole number. */
  format?: number;
  /**
   * How many lines it takes, its two lines of `---` included: 0 when the file doesn't start with
   * one, and undefined when it never closes, so where the text after it starts is unknown.
   */
  lines: number | undefined;
}

const KEYS = ['format', 'pr', 'commit'] as const;
type Key = (typeof KEYS)[number];

/** The largest number GitHub gives a pull request. */
const MAX_PR = 2 ** 31 - 1;

/**
 * The header at the start of `start`, the file's first characters with its line endings as
 * `\n`, with what's wrong with it added to `findings`. A format newer than {@link FORMAT} is all
 * that's reported then: a newer header may hold what this one can't.
 */
export function readHeader(start: string, findings: Findings): HeaderRead {
  const lines = start.split('\n');
  if (!isDelimiter(lines[0])) {
    findings.add(
      'header-missing',
      1,
      'artifact.md starts with its header: a line of ---, then format, pr and commit, each on its own line, then ---.',
    );
    return { lines: 0 };
  }
  const closing = lines.findIndex((line, index) => index > 0 && isDelimiter(line));
  if (closing < 0) {
    findings.add('header-unclosed', 1, 'The header has no closing ---.');
    return { lines: undefined };
  }

  const found: [FindingCode, number, string][] = [];
  const values = new Map<Key, { value: string; line: number }>();
  let twice = false;
  for (let index = 1; index < closing; index++) {
    const line = index + 1;
    const pair = keyValue(lines[index]!);
    if (!pair) {
      found.push([
        'header-line',
        line,
        'The header holds only lines of key: value, such as pr: 4797.',
      ]);
      continue;
    }
    const key = KEYS.find((known) => known === pair.key);
    if (!key) {
      found.push([
        'header-key',
        line,
        `The header can't hold ${quote(pair.key)}. It holds format, pr and commit.`,
      ]);
      continue;
    }
    if (values.has(key)) {
      found.push(['header-twice', line, `The header gives ${key} twice.`]);
      if (key === 'format') twice = true;
      continue;
    }
    values.set(key, { value: pair.value, line });
  }

  const format = values.get('format');
  const version =
    format && /^[1-9][0-9]{0,8}$/.test(format.value) ? Number(format.value) : undefined;
  const taken = closing + 1;
  if (format && version !== undefined && version > FORMAT && !twice) {
    findings.add(
      'format-newer',
      format.line,
      `It's written in format ${version}, and this version of Lo reads ${formats()}.`,
    );
    return { format: version, lines: taken };
  }
  if (!format) {
    found.push(['format-missing', 1, 'The header has no format version. Add format: 1.']);
  } else if (version === undefined) {
    found.push(['format-invalid', format.line, 'The format version is a whole number, such as 1.']);
  }

  const pr = values.get('pr');
  const number = pr && /^[1-9][0-9]{0,9}$/.test(pr.value) ? Number(pr.value) : undefined;
  if (!pr) {
    found.push([
      'pr-missing',
      1,
      "The header has no pr: the pull request's number, such as pr: 4797.",
    ]);
  } else if (number === undefined || number > MAX_PR) {
    found.push(['pr-invalid', pr.line, "pr is the pull request's number, such as 4797."]);
  }

  const commit = values.get('commit');
  const id =
    commit && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit.value) ? commit.value : undefined;
  if (!commit) {
    found.push([
      'commit-missing',
      1,
      'The header has no commit: the full id of the commit the overview describes.',
    ]);
  } else if (id === undefined) {
    found.push([
      'commit-invalid',
      commit.line,
      'commit is the full id of the commit the overview describes: 40 or 64 lowercase hexadecimal digits.',
    ]);
  }

  for (const [code, line, message] of found) findings.add(code, line, message);
  const valid =
    found.length === 0 && version !== undefined && number !== undefined && id !== undefined;
  return {
    ...(valid ? { header: { format: version, pr: number, commit: id } } : {}),
    ...(version === undefined ? {} : { format: version }),
    lines: taken,
  };
}

/** The formats this version reads, in words. */
function formats(): string {
  return FORMAT === 1 ? 'format 1' : `formats 1 to ${FORMAT}`;
}

/** Whether `line` is `---`, perhaps with spaces or tabs after it. */
function isDelimiter(line: string | undefined): boolean {
  return line !== undefined && line.startsWith('---') && isBlank(line.slice(3));
}

/** `line` as a lowercase key, a colon and a value, with the spaces and tabs around the value off. */
function keyValue(line: string): { key: string; value: string } | undefined {
  let at = 0;
  while (at < line.length && line.charCodeAt(at) >= 0x61 && line.charCodeAt(at) <= 0x7a) at += 1;
  if (at === 0 || line[at] !== ':') return undefined;
  let from = at + 1;
  let to = line.length;
  while (from < to && isSpace(line.charCodeAt(from))) from += 1;
  while (to > from && isSpace(line.charCodeAt(to - 1))) to -= 1;
  return { key: line.slice(0, at), value: line.slice(from, to) };
}

function isBlank(text: string): boolean {
  for (let at = 0; at < text.length; at++) if (!isSpace(text.charCodeAt(at))) return false;
  return true;
}

function isSpace(unit: number): boolean {
  return unit === 0x20 || unit === 0x09;
}
