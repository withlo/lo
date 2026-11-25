// What an overview looks like, for the welcome's step that says what one is: the top of one, at the
// size and in the styles a pull request's overview has, cut off by its frame. Its tl;dr, a sentence
// that links into the code, and the code block it points at, as a diff. It's drawn, not read from
// a pull request: nothing in it responds, and a screen reader hears what it shows.

import { lineRange, PathName } from '@lo/ui/overview';
import type { ReactNode } from 'react';

/** What a screen reader hears of it. */
const HEARD =
  'An overview: a heading, a sentence about the change with a link into the code, and the lines that changed in parser.ts';

/** A run of a line's code, and its syntax colour, as the code views give it. */
type Run = readonly [text: string, color?: string];

const KEYWORD = 'text-syn-keyword';
const NAME = 'text-syn-variable';
const CALL = 'text-syn-function';
const MARK = 'text-syn-punctuation';
const STRING = 'text-syn-string';
const ESCAPE = 'text-syn-escape';

/** `return input.split(…).map(toLine);`, splitting on `by`, a line of the function's body. */
function splitLine(by: readonly Run[]): readonly Run[] {
  return [
    ['  '],
    ['return', KEYWORD],
    [' '],
    ['input', NAME],
    ['.', MARK],
    ['split', CALL],
    ['(', MARK],
    ...by,
    [')', MARK],
    ['.', MARK],
    ['map', CALL],
    ['(', MARK],
    ['toLine', NAME],
    [')', MARK],
    [';', MARK],
  ];
}

/** `runs`, each with the column it starts at, which keys it. */
function placed(runs: readonly Run[]): { at: number; text: string; color?: string | undefined }[] {
  let at = 0;
  return runs.map(([text, color]) => {
    const run = { at, text, color };
    at += text.length;
    return run;
  });
}

/** One line of the block: its number on the old side and the new, its ground, and its code. */
interface Row {
  readonly old?: number;
  readonly new?: number;
  readonly ground: string;
  readonly runs: readonly Run[];
}

/** The line the change is on, removed and added, and the one after, which the frame cuts. */
const ROWS: readonly Row[] = [
  {
    old: 9,
    ground: 'bg-diff-del-bg',
    runs: splitLine([
      ["'", STRING],
      [String.raw`\n`, ESCAPE],
      ["'", STRING],
    ]),
  },
  { new: 9, ground: 'bg-diff-add-bg', runs: splitLine([[String.raw`/\r?\n/`, STRING]]) },
  { old: 10, new: 10, ground: '', runs: [['}', MARK]] },
];

const PATH = 'src/parser.ts';

export function Example(): ReactNode {
  return (
    <div
      role="img"
      aria-label={HEARD}
      className="box-content h-overview-example-h flex-none overflow-hidden rounded-lg border border-border-subtle bg-bg select-none"
    >
      {/* Out of reach as well as unheard: the frame says what it shows. */}
      <div inert className="lo-prose px-24 pt-16 select-none">
        <h2 className="mt-0">tl;dr</h2>
        <p className="lo-lead mt-8">
          <a>The parser</a> now splits on <code>{String.raw`\r\n`}</code> as well as{' '}
          <code>{String.raw`\n`}</code>, so a file saved on Windows reads as the same lines.
        </p>
        <div className="lo-codeblock mt-16">
          <div className="lo-codeblock__head h-control-h">
            <span className="lo-codeblock__where">
              <span className="lo-codeblock__path">
                <PathName path={PATH} />
              </span>
              <span className="lo-codeblock__lines">{lineRange({ start: 9, end: 9 })}</span>
            </span>
          </div>
          {ROWS.map((row) => (
            <div
              key={`${row.old}:${row.new}`}
              className={`flex h-code-line text-code-fg code-text ${row.ground}`}
            >
              <span className="lo-ln w-40 flex-none">{row.old}</span>
              <span className="lo-ln w-40 flex-none">{row.new}</span>
              <span className="min-w-0 flex-1 ps-8 pe-16 whitespace-pre">
                {placed(row.runs).map(({ at, text, color }) => (
                  <span key={at} className={color}>
                    {text}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
