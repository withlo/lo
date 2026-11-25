// The welcome's third step: choosing the keys code and comment boxes are edited with, the
// standard ones or Vim's, over a few lines of diff to try Lo's own single keys on, by key or by
// click, and a comment box to try the choice in.

import {
  Button,
  Choices,
  CommentBoxFootBar,
  CommentBoxHeadBar,
  HintButton,
  Key,
  type ChoiceItem,
  type CommentBoxMode,
} from '@lo/ui';
import { createComposer, onVim, vimOn, type BoxParts, type Composer, type Mode } from '@lo/ui/code';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { chooseVim, VIM } from './actions.ts';
import { StepHeading } from './Heading.tsx';
import { useNonce } from './nonce.ts';
import { setPracticeEscape } from './practice.ts';
import { welcomeStore } from './store.ts';

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

const ROW =
  'relative isolate flex h-code-line cursor-default items-center whitespace-pre code-text';
const ROW_SIGN = { '+': 'bg-diff-add-bg', '-': 'bg-diff-del-bg', ' ': '' } as const;
const NUMBER = 'w-40 flex-none pe-8 text-end lo-num';
const MARK = 'w-16 flex-none';
const MARK_SIGN = { '+': 'text-diff-add-fg', '-': 'text-diff-del-fg', ' ': '' } as const;

/** Vim's modes, as the comment box's foot names them. */
const MODES: Readonly<Record<Mode, CommentBoxMode>> = {
  normal: { name: 'NORMAL', kind: 'normal' },
  insert: { name: 'INSERT', kind: 'insert' },
  visual: { name: 'VISUAL', kind: 'visual' },
};

/** A key as this system shows it, from its name in the keymap file. */
function shown(key: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(key), system), system);
}

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
 * The comment box `c` opens, the one every comment is written in, with the keys chosen above.
 * Nothing in it is sent: its own send keys do nothing, and `Esc` or its close control put it away,
 * keeping what was typed. It's drawn from the start and only shown while it's open, over the keys'
 * buttons, so opening it moves nothing.
 */
function PracticeBox({
  open,
  line,
  onClose,
}: {
  open: boolean;
  /** The number of the line it's on. */
  line: number;
  /** Puts it away: `Esc` in it, or its close control. */
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const nonce = useNonce();
  const id = useId();
  const box = useRef<Composer>(undefined);
  const [parts, setParts] = useState<BoxParts>();
  const [mode, setMode] = useState<Mode>('insert');
  const [previewing, setPreviewing] = useState(false);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const closing = useRef(onClose);
  closing.current = onClose;

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent || nonce === undefined) return undefined;
    const made = createComposer(
      parent,
      { draft: '', nonce, label: 'Comment' },
      {
        change: setText,
        // Nothing here is sent.
        submit() {},
        close: () => closing.current(),
        mode: setMode,
        preview: setPreviewing,
      },
      (given) => {
        setParts(given);
        return { destroy: () => setParts(undefined) };
      },
    );
    box.current = made;
    return () => {
      box.current = undefined;
      made.dismiss();
    };
  }, [nonce]);

  // It takes focus as it opens, ready to type in, as a comment box does.
  useEffect(() => {
    if (open) box.current?.focus();
  }, [open, parts]);

  // Focus in the box lights its mode chip, with Vim keys on.
  useEffect(() => {
    const frame = parts?.foot.parentElement;
    if (!frame) return undefined;
    const into = () => setFocused(true);
    const out = (event: FocusEvent) => {
      const to = event.relatedTarget;
      if (!(to instanceof Node) || !frame.contains(to)) setFocused(false);
    };
    frame.addEventListener('focusin', into);
    frame.addEventListener('focusout', out);
    return () => {
      frame.removeEventListener('focusin', into);
      frame.removeEventListener('focusout', out);
    };
  }, [parts]);

  const preview = (on: boolean) => {
    box.current?.preview(on);
    setPreviewing(on);
  };
  const discard = () => {
    const made = box.current;
    made?.replace(0, made.text.length, '');
    closing.current();
  };
  return (
    <div
      ref={host}
      className={open ? undefined : 'invisible'}
      inert={!open}
      aria-hidden={open ? undefined : true}
    >
      {parts &&
        createPortal(
          <CommentBoxHeadBar
            head={{
              where: `Line ${line}`,
              onPreviewing: preview,
              close: { keys: shown('esc'), onClick: () => box.current?.leave() },
            }}
            previewing={previewing}
          />,
          parts.head,
          'head',
        )}
      {parts &&
        previewing &&
        createPortal(
          <p className="m-0 whitespace-pre-wrap read-comment">{text}</p>,
          parts.preview,
          'preview',
        )}
      {parts &&
        createPortal(
          <CommentBoxFootBar
            id={id}
            focused={focused}
            foot={{
              mode: MODES[mode],
              discard: {
                disabled: text === '',
                why: text === '' ? 'Nothing to discard' : undefined,
                onClick: discard,
              },
            }}
          />,
          parts.foot,
          'foot',
        )}
    </div>
  );
}

/**
 * A few lines of diff with a cursor: `j` and `k` move it, as the arrows and a click do, and `c`
 * opens a comment box on its line, which nothing sends. Under it, each key is a button.
 */
function Practice() {
  const lines = useRef<HTMLDivElement>(null);
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
    setPracticeEscape({
      open: () => writes.current,
      close: () => {
        setWriting(false);
        lines.current?.focus();
      },
    });
    return () => setPracticeEscape(undefined);
  }, []);

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
        className="overflow-hidden rounded-md border border-border bg-code-bg py-4 focus-visible:shadow-ring"
        onKeyDown={onKeyDown}
      >
        {LINES.map((line, index) => {
          const current = index === at;
          return (
            <div
              key={index}
              id={`welcome-line-${index}`}
              role="option"
              aria-selected={current}
              // The cursor's line keeps its tint while the box is open, and only its ring goes:
              // one ring at a time, the box's.
              className={`${ROW} ${ROW_SIGN[line.sign]} ${current && !writing ? 'shadow-ring-inset' : ''}`}
              onClick={() => {
                setAt(index);
                lines.current?.focus();
              }}
            >
              {current && (
                <span className="absolute inset-0 -z-1 bg-on-screen" aria-hidden="true" />
              )}
              <span
                className={`${NUMBER} ${current ? 'text-code-gutter-active' : 'text-code-gutter'}`}
              >
                {line.number}
              </span>
              <span className={`${MARK} ${MARK_SIGN[line.sign]}`} aria-hidden="true">
                {line.sign}
              </span>
              <span className="text-code-fg">{line.code}</span>
            </div>
          );
        })}
      </div>
      {/* The box opens under the lines, over the keys' buttons, in room held for it. */}
      <div className="grid">
        <div
          className={`col-start-1 row-start-1 flex flex-wrap items-start gap-2 ${writing ? 'invisible' : ''}`}
          inert={writing}
        >
          <PracticeHint keys="j" onPress={() => move(1)}>
            Next line
          </PracticeHint>
          <PracticeHint keys="k" onPress={() => move(-1)}>
            Previous line
          </PracticeHint>
          <PracticeHint keys="c" onPress={comment}>
            Comment
          </PracticeHint>
          <span className="flex-1" />
          <HintButton command="keys.help" />
          <HintButton command="keys.palette" />
        </div>
        {/* Out of the pointer's way while the box is put away, so the buttons under it press. */}
        <div className={`col-start-1 row-start-1 ${writing ? '' : 'pointer-events-none'}`}>
          <PracticeBox open={writing} line={here?.number ?? 0} onClose={close} />
        </div>
      </div>
    </div>
  );
}

export function KeysStep(): ReactNode {
  const vim = useSyncExternalStore(onVim, vimOn, vimOn);
  // The last card pressed, while the setting is being written.
  const pressed = useStore(welcomeStore, (state) => state.choosing[VIM]);
  const chosen = typeof pressed === 'boolean' ? pressed : vim;
  return (
    <>
      <StepHeading
        title="Choose your keys"
        line="Single keys and the mouse work with both. Also in Settings › Keyboard."
      />
      <Choices
        label="Keys"
        items={EDITING}
        value={chosen ? 'vim' : 'standard'}
        onChange={(value) => void chooseVim(value === 'vim')}
      />
      <Practice />
    </>
  );
}
