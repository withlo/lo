// The welcome's second step: choosing the keys code and comment boxes are edited with, the
// standard ones or Vim's, over a few lines of diff to try Lo's own single keys on, by key or by
// click.

import { Button, Choices, HintButton, Input, Key, type ChoiceItem } from '@lo/ui';
import { onVim, vimOn } from '@lo/ui/code';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { chooseVim } from './actions.ts';
import { setPracticeEscape } from './practice.ts';

type Editing = 'standard' | 'vim';

const EDITING: readonly ChoiceItem<Editing>[] = [
  {
    value: 'standard',
    title: 'Standard',
    description: 'A plain caret in code and comment boxes.',
  },
  {
    value: 'vim',
    title: 'Vim keys',
    description: 'Modes and motions in code and comment boxes.',
  },
];

interface Line {
  /** The line's number in the file, on whichever side it's on. */
  readonly number: number;
  readonly sign: '+' | '-' | ' ';
  readonly code: string;
}

/** A few lines of a change, enough to move over. */
const LINES: readonly Line[] = [
  { number: 41, sign: ' ', code: 'export function lineDown(view: View): void {' },
  { number: 42, sign: '-', code: '  view.line += 1;' },
  { number: 42, sign: '+', code: '  view.line = Math.min(view.line + 1, view.last);' },
  { number: 43, sign: ' ', code: '  view.reveal();' },
  { number: 44, sign: ' ', code: '}' },
];

const START = 2;

const ROW = 'flex h-code-line cursor-default items-center whitespace-pre code-text';
const ROW_SIGN = { '+': 'bg-diff-add-bg', '-': 'bg-diff-del-bg', ' ': '' } as const;
const NUMBER = 'w-40 flex-none pe-8 text-end lo-num';
const MARK = 'w-16 flex-none';
const MARK_SIGN = { '+': 'text-diff-add-fg', '-': 'text-diff-del-fg', ' ': '' } as const;

/** A hint that's a button, as `HintButton` is, for a key that's only the practice's. */
function PracticeHint({
  keys,
  onPress,
  children,
}: {
  keys: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-keyshortcuts={keys}
      // A click leaves focus on the lines, so the keys beside it go on working.
      onMouseDown={(event: MouseEvent) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
      <Key keys={[keys]} quiet decorative />
    </Button>
  );
}

/**
 * A few lines of diff with a cursor: `j` and `k` move it, as the arrows and a click do, and `c`
 * opens a comment box on its line, which nothing sends. Under it, each key is a button.
 */
function Practice() {
  const lines = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [at, setAt] = useState(START);
  const [writing, setWriting] = useState(false);
  const writes = useRef(writing);
  writes.current = writing;

  const move = (by: 1 | -1) => setAt((was) => Math.min(LINES.length - 1, Math.max(0, was + by)));
  const comment = () => setWriting(true);
  const close = () => {
    setWriting(false);
    lines.current?.focus();
  };

  useEffect(() => {
    setPracticeEscape(() => {
      if (!writes.current) return false;
      setWriting(false);
      lines.current?.focus();
      return true;
    });
    return () => setPracticeEscape(undefined);
  }, []);

  // The box takes focus as it opens, as a comment box does.
  useEffect(() => {
    if (writing) field.current?.focus();
  }, [writing]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'j' || event.key === 'ArrowDown') move(1);
    else if (event.key === 'k' || event.key === 'ArrowUp') move(-1);
    else if (event.key === 'c') comment();
    else return;
    event.preventDefault();
  };

  const here = LINES[at];
  return (
    <div className="flex flex-col gap-6">
      <div
        ref={lines}
        role="listbox"
        aria-label="Practice diff"
        aria-activedescendant={`welcome-line-${at}`}
        tabIndex={0}
        data-welcome-focus
        className="overflow-hidden rounded-md border border-border bg-code-bg pt-4 focus-visible:shadow-ring"
        onKeyDown={onKeyDown}
      >
        {LINES.map((line, index) => (
          <div key={index}>
            <div
              id={`welcome-line-${index}`}
              role="option"
              aria-selected={index === at}
              className={`${ROW} ${ROW_SIGN[line.sign]} ${index === at ? 'shadow-ring-inset' : ''}`}
              onClick={() => {
                setAt(index);
                lines.current?.focus();
              }}
            >
              <span
                className={`${NUMBER} ${index === at ? 'text-code-gutter-active' : 'text-code-gutter'}`}
              >
                {line.number}
              </span>
              <span className={`${MARK} ${MARK_SIGN[line.sign]}`} aria-hidden="true">
                {line.sign}
              </span>
              <span className="text-code-fg">{line.code}</span>
            </div>
            {writing && index === at && (
              <div className="flex h-48 items-center gap-8 border-y border-border-subtle bg-bg-chrome px-12">
                <Input
                  ref={field}
                  aria-label={`Comment on line ${here?.number ?? ''}`}
                  placeholder="Write a comment. Nothing here is sent."
                />
                <Button size="sm" onClick={close}>
                  Close
                  <Key keys={['Esc']} quiet decorative />
                </Button>
              </div>
            )}
          </div>
        ))}
        {/* The room a comment box takes, kept, so opening one moves nothing under the diff. */}
        {!writing && <div className="h-48" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PracticeHint keys="j" onPress={() => move(1)}>
          Line down
        </PracticeHint>
        <PracticeHint keys="k" onPress={() => move(-1)}>
          Line up
        </PracticeHint>
        <PracticeHint keys="c" onPress={comment}>
          Comment
        </PracticeHint>
        <span className="flex-1" />
        <HintButton command="keys.help" />
        <HintButton command="keys.palette" />
      </div>
    </div>
  );
}

export function KeysStep(): ReactNode {
  const vim = useSyncExternalStore(onVim, vimOn, vimOn);
  return (
    <>
      <div className="flex flex-col gap-6">
        <h1 className="m-0 text-heading">Choose your keys</h1>
        <p className="m-0 text-fg-muted text-ui">
          Lo’s single keys work with both, and so does the mouse.
        </p>
      </div>
      <Choices
        label="Keys"
        items={EDITING}
        value={vim ? 'vim' : 'standard'}
        onChange={(value) => chooseVim(value === 'vim')}
      />
      <Practice />
    </>
  );
}
