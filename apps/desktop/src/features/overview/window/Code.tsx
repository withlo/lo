// An overview's code blocks and walkthroughs, filled in from the pull request's local copy. A
// code block is laid out from what the overview says it points at, as tall as its lines, and keeps
// what's on screen where it is as its code comes (`Held`). Each file a block shows is read and
// diffed once for every block on it (`files.ts`). A block near the screen draws its code once it's
// in, and those near it as the overview is first laid out draw before it's seen (`drawing.ts`);
// one far from it draws once too, in turn with the others, for its height, and lets its code go,
// keeping its room. The window keeps no code but what's drawn, and what's read for it a little
// while.

import type { CodeRange, Excerpt, Walkthrough as WalkthroughNode } from '@lo/artifact';
import { Button, Key } from '@lo/ui';
import {
  codeTypeface,
  createExcerptView,
  createFileView,
  type ExcerptView,
  type FileView,
} from '@lo/ui/code';
import {
  CodeBlock,
  CodeBody,
  CodeFlag,
  CodeNote,
  Held,
  useNear,
  useNearness,
  Walkthrough,
  type CodeBlockVariant,
} from '@lo/ui/overview';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { registry } from '../../../window/commands/registry.ts';
import { useLocalCopy, usePull, useTabState } from '../../tab/window/shared.ts';
import { findFile, showFile } from '../../tree/window/shared.ts';
import { onStep, setStep, stepOf } from './blocks.ts';
import type { CodeRead } from './checking.ts';
import { useFirstDraw, type FirstDraw } from './drawing.ts';
import { revisionAt } from './facts.ts';
import { holdFile, type FileCode, type FileHold } from './files.ts';
import { keyOf } from './labels.ts';
import { blockChange, linesIn, type BlockChange } from './mapping.ts';
import { CompareButton } from './OutOfDate.tsx';
import { usePage } from './page.ts';
import { shortId } from './says.ts';
import { fileSince } from './since.ts';
import { flagWords, labelOf } from './stale.ts';
import { revisions } from './store.ts';
import { nameOf, showsOf, type Shows, type Target, type Words } from './targets.ts';

/**
 * The commit tab `tab`'s diff starts from, for a stack's layer, as its local copy last said: a
 * block's base side starts there too. Empty for one that starts at its base branch.
 */
function useStartOf(tab: string): string {
  const local = useLocalCopy(tab);
  return (local?.kind === 'ready' ? local.from?.commit : undefined) ?? '';
}

/**
 * What the overview's blocks read their code with: the pull request's tab, the commit the overview
 * describes, the head on screen when that's another commit, how far its code was read, and how the
 * check left each place it points at.
 */
export interface CodeContext {
  readonly tab: string;
  readonly commit: string;
  readonly head?: string | undefined;
  readonly read: CodeRead;
  readonly target: (target: CodeRange) => Target;
}

/** The events of a code view in an overview: none it acts on yet. */
const QUIET = {
  cursor() {},
  mode() {},
  jumped() {},
  menu() {},
};

/** No lines changed since. */
const UNCHANGED: readonly number[] = [];

/** How lines a block shows changed by a head, which its flag says once its code is drawn. */
interface Changed {
  readonly head: string;
  readonly change: BlockChange;
}

/** How many lines `target` names. */
function rowsOf(target: CodeRange): number {
  return target.lines.end - target.lines.start + 1;
}

/** A `:::code` block: the lines it names, at the commit the overview describes. */
export function ExcerptBlock({ node, context }: { node: Excerpt; context: CodeContext }) {
  const { target } = node;
  const shows = showsOf(target, context.target(target), context.read, context.commit);
  // Why main couldn't read the code, until the code is read again.
  const [failed, setFailed] = useState<{ read: CodeRead; why: string } | undefined>(undefined);
  const { read } = context;
  const unread = failed?.read === read ? failed.why : undefined;
  const failing = useCallback((why: string) => setFailed({ read, why }), [read]);
  const variant: CodeBlockVariant = shows.kind === 'note' ? shows.variant : 'code';
  // Which of its lines changed by the head on screen, said with its code, as it's drawn. After a
  // newer push is loaded, what it said of the last head stays until it's said of the new one.
  const [changed, setChanged] = useState<Changed | undefined>(undefined);
  const { head } = context;
  const flagged =
    shows.kind === 'code' &&
    unread === undefined &&
    head !== undefined &&
    changed !== undefined &&
    changed.change.kind !== 'none'
      ? changed
      : undefined;
  return (
    <Held>
      <CodeBlock
        target={target}
        variant={variant}
        actions={
          shows.kind === 'note' && shows.action ? (
            <Action shows={shows} tab={context.tab} path={target.path} />
          ) : undefined
        }
        flag={
          flagged && (
            <Flag
              tab={context.tab}
              commit={context.commit}
              head={flagged.head}
              change={flagged.change}
            />
          )
        }
      >
        <CodeBody rows={rowsOf(target)}>
          {shows.kind === 'note' ? (
            <CodeNote title={shows.title}>
              <Said words={shows.words} />
            </CodeNote>
          ) : unread !== undefined ? (
            <CodeNote title="Lo couldn’t read this code.">{unread}</CodeNote>
          ) : (
            <ExcerptCode
              tab={context.tab}
              commit={context.commit}
              head={head}
              target={target}
              unread={failing}
              changed={setChanged}
            />
          )}
        </CodeBody>
      </CodeBlock>
    </Held>
  );
}

/** Each overview's far blocks drawn for their height, one at a time, once it's first seen. */
const measuring = new WeakMap<object, Promise<void>>();
/** Where blocks outside an overview's first frame, as in tests, take turns. */
const ALONE = {};

/** A far block's turn to draw for its height: `ready` once it's its turn, `done` to end it. */
function turn(first: FirstDraw | undefined): { ready: Promise<void>; done: () => void } {
  let done!: () => void;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const key = first ?? ALONE;
  const before = measuring.get(key) ?? Promise.resolve();
  measuring.set(
    key,
    before.then(() => finished),
  );
  return { ready: Promise.all([before, first?.seen]).then(() => undefined), done };
}

/**
 * A code block's code: drawn once it's in, near the screen; far from it, drawn once in turn for its
 * height, and let go, keeping its room. Near the screen as the overview is first laid out, it
 * draws before the overview is seen. When `head`, the head on screen, isn't the overview's commit,
 * it's drawn once what changed in its file by the head is in too, its changed lines marked, and
 * says which to `changed` as it's drawn, for its flag.
 */
function ExcerptCode({
  tab,
  commit,
  head,
  target,
  unread,
  changed,
}: {
  tab: string;
  commit: string;
  head: string | undefined;
  target: CodeRange;
  unread: (why: string) => void;
  changed: (changed: Changed | undefined) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const nearness = useNearness(box);
  const near = nearness === 'near';
  const page = usePage();
  const first = useFirstDraw();
  const id = `overview-code${useId()}`;
  const [code, setCode] = useState<Extract<FileCode, { kind: 'code' }> | undefined>(undefined);
  // Its lines that changed by the head on screen, marked as it's drawn.
  const [stale, setStale] = useState<readonly number[]>(UNCHANGED);
  // Whether it's been drawn, so its room is its code's height.
  const [measured, setMeasured] = useState(false);
  const drawnView = useRef<ExcerptView>(undefined);
  const want = near || (nearness === 'far' && !measured);
  const from = useStartOf(tab);
  const { path } = target;
  const { start, end } = target.lines;
  // Who's told the code couldn't be read, which changes without asking for it again.
  const failed = useRef(unread);
  useLayoutEffect(() => {
    failed.current = unread;
  }, [unread]);
  // Who's told which of its lines changed.
  const tell = useRef(changed);
  useLayoutEffect(() => {
    tell.current = changed;
  }, [changed]);

  // Near the screen as the overview is first laid out, it draws before it's seen.
  const drawn = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    drawn.current = first?.begin();
    return () => drawn.current?.();
  }, [first]);
  useEffect(() => {
    if (nearness === 'far') drawn.current?.();
  }, [nearness]);

  useEffect(() => {
    if (!want) {
      setCode(undefined);
      return undefined;
    }
    let live = true;
    const wait = near ? undefined : turn(first);
    let hold: FileHold | undefined;
    void (async () => {
      await wait?.ready;
      if (!live) return;
      hold = holdFile(tab, commit, path, first?.onScreen() ?? true, from);
      const found = await hold.code;
      // What changed by the head on screen, so the code is drawn once, with its flag.
      const since =
        head === undefined || found.kind === 'unread'
          ? undefined
          : await fileSince(tab, commit, head, path, {
              soon: near,
              quick: first?.onScreen() ?? true,
            });
      // Drawn in its own typeface, it's as tall as it stays.
      await codeTypeface();
      if (!live) return;
      if (found.kind === 'unread') {
        drawn.current?.();
        failed.current(found.why);
        return;
      }
      const change = since && blockChange(since, { start, end });
      setStale(change?.kind === 'lines' ? linesIn(change.changed) : UNCHANGED);
      tell.current(head === undefined || !change ? undefined : { head, change });
      setCode(found);
    })();
    return () => {
      live = false;
      wait?.done();
      hold?.release();
    };
  }, [want, near, first, tab, commit, head, path, start, end, from]);

  // Its lines that changed, marked on the view it has, which isn't drawn again for them, so it
  // keeps its highlighting; and on the next one it's drawn with.
  const marked = useRef(stale);
  useLayoutEffect(() => {
    marked.current = stale;
    drawnView.current?.setStale(stale);
  }, [stale]);

  useLayoutEffect(() => {
    const parent = box.current;
    if (!parent || !page || !code) return undefined;
    parent.style.minHeight = '';
    const keys = registry();
    const view = createExcerptView(
      parent,
      {
        id,
        path,
        lines: code.lines,
        diff: code.diff,
        range: { side: 'new', from: start, to: end },
        stale: marked.current,
        vimKeys: keys.vimKeys(),
        nonce: page.nonce,
      },
      QUIET,
    );
    drawnView.current = view;
    // Its height is its code's once the view has measured its lines, which it does a frame on.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setMeasured(true);
        drawn.current?.();
      });
    });
    const stop = keys.subscribe(() => view.setVimKeys(keys.vimKeys()));
    return () => {
      drawnView.current = undefined;
      cancelAnimationFrame(frame);
      // Let go far from the screen, it keeps its room: as tall as its lines, laid out.
      parent.style.minHeight = `${view.height()}px`;
      stop();
      view.destroy();
    };
  }, [code, page, id, path, start, end]);

  // Highlighted near the screen once the diff's job has it, which changes no line's height; drawn
  // only for its height, far from it, it isn't.
  useEffect(() => {
    const view = drawnView.current;
    if (!near || !code || !view) return undefined;
    let live = true;
    void code.highlighted().then((tokens) => {
      if (!live || drawnView.current !== view) return;
      if (tokens.old) view.setTokens('old', tokens.old);
      if (tokens.new) view.setTokens('new', tokens.new);
    });
    return () => {
      live = false;
    };
  }, [near, code]);

  return <div ref={box} data-lo-code={code ? 'drawn' : measured ? 'measured' : 'waiting'} />;
}

/**
 * A code block's flag, for lines it shows that changed between the overview's commit and the head
 * on screen, with the way to the comparison.
 */
function Flag({
  tab,
  commit,
  head,
  change,
}: {
  tab: string;
  commit: string;
  head: string;
  change: BlockChange;
}) {
  const known = useTabState(revisions, tab);
  const words = flagWords(change, { written: labelOf(known, commit), now: labelOf(known, head) });
  if (words === undefined) return null;
  return (
    <CodeFlag action={<CompareButton tab={tab} from={commit} to={head} variant="ghost" />}>
      {words}
    </CodeFlag>
  );
}

/** A `:::walkthrough` block: its steps beside the current one's file, its lines marked. */
export function WalkthroughBlock({
  node,
  context,
}: {
  node: WalkthroughNode;
  context: CodeContext;
}) {
  // The step the reader left it at, when it's drawn again, and which following it goes to; or the
  // one a note in the diff asked for.
  const at = useSyncExternalStore(onStep, () => stepOf(node));
  const goTo = useCallback((next: number) => setStep(node, next), [node]);
  const step = node.steps[at];
  const shows =
    step && showsOf(step.target, context.target(step.target), context.read, context.commit);
  return (
    <Held>
      <Walkthrough
        node={node}
        current={at}
        step={goTo}
        code={
          step &&
          shows &&
          (shows.kind === 'note' ? (
            <Note shows={shows} tab={context.tab} path={step.target.path} />
          ) : (
            <StepCode tab={context.tab} commit={context.commit} target={step.target} />
          ))
        }
      />
    </Held>
  );
}

/** A file read whole for a walkthrough's step: its lines and highlighting, or why it wasn't. */
type StepFile =
  | { path: string; lines: string[]; tokens: Promise<Uint32Array | undefined> }
  | { path: string; unread: string };

/**
 * The current step's file, whole, at the commit the overview describes, its lines marked and near
 * the top of its box, which scrolls on its own. Read near the screen, drawn once it's in, and let
 * go far from it; another step in the same file marks its lines in the same view.
 */
function StepCode({ tab, commit, target }: { tab: string; commit: string; target: CodeRange }) {
  const box = useRef<HTMLDivElement>(null);
  const near = useNear(box);
  const page = usePage();
  const first = useFirstDraw();
  const id = `overview-step${useId()}`;
  const view = useRef<FileView>(undefined);
  const [file, setFile] = useState<StepFile | undefined>(undefined);
  const from = useStartOf(tab);
  const { path } = target;
  const { start, end } = target.lines;

  useEffect(() => {
    setFile(undefined);
    if (!near) return undefined;
    let live = true;
    const hold = holdFile(tab, commit, path, first?.onScreen() ?? true, from);
    void hold.code.then((found) => {
      if (!live) return;
      setFile(
        found.kind === 'unread'
          ? { path, unread: found.why }
          : {
              path,
              lines: found.lines.new,
              tokens: found.highlighted().then((tokens) => tokens.new),
            },
      );
    });
    return () => {
      live = false;
      hold.release();
    };
  }, [near, first, tab, commit, path, from]);

  const lines = file && 'lines' in file ? file : undefined;
  useLayoutEffect(() => {
    const parent = box.current;
    if (!parent || !page || !lines) return undefined;
    const keys = registry();
    const made = createFileView(
      parent,
      {
        id,
        path: lines.path,
        lines: lines.lines,
        vimKeys: keys.vimKeys(),
        nonce: page.nonce,
      },
      QUIET,
    );
    view.current = made;
    let live = true;
    void lines.tokens.then((tokens) => {
      if (live && tokens) made.setTokens(tokens);
    });
    const stop = keys.subscribe(() => made.setVimKeys(keys.vimKeys()));
    return () => {
      live = false;
      stop();
      view.current = undefined;
      made.destroy();
    };
  }, [lines, page, id]);

  // The step's lines, marked and near the top of the box, in the file on screen.
  useLayoutEffect(() => {
    const made = view.current;
    if (!made || lines?.path !== path) return;
    made.setMarks([{ kind: 'lines', at: { file: id, side: 'new', from: start, to: end } }]);
    made.showLine(start);
  }, [lines, path, id, start, end]);

  if (file && 'unread' in file) {
    return <CodeNote title="Lo couldn’t read this code.">{file.unread}</CodeNote>;
  }
  return <div ref={box} className="h-full" data-lo-code={lines ? 'drawn' : 'waiting'} />;
}

/** Words, with paths set as code. */
function Said({ words }: { words: Words }) {
  return (
    <>
      {words.map((part, index) =>
        typeof part === 'string' ? part : <code key={index}>{part.code}</code>,
      )}
    </>
  );
}

/** What a walkthrough's step says in its code's place, with what the reader can do about it. */
function Note({
  shows,
  tab,
  path,
}: {
  shows: Extract<Shows, { kind: 'note' }>;
  tab: string;
  path: string;
}) {
  return (
    <CodeNote
      title={shows.title}
      action={shows.action && <Action shows={shows} tab={tab} path={path} />}
    >
      <Said words={shows.words} />
    </CodeNote>
  );
}

/** What the reader can do about a block's code that isn't there: find a file, or see the newest. */
function Action({
  shows,
  tab,
  path,
}: {
  shows: Extract<Shows, { kind: 'note' }>;
  tab: string;
  path: string;
}) {
  const { action } = shows;
  if (action?.kind === 'find') return <FindButton name={action.name} />;
  if (action?.kind === 'latest') return <LatestButton tab={tab} path={path} />;
  return null;
}

/** "Find a file named cache.ts": the file finder, with the name typed. */
function FindButton({ name }: { name: string }) {
  const keys = keyOf('tree.find');
  return (
    <Button size="sm" onClick={() => findFile(name)}>
      Find a file named {name}
      {keys !== undefined && <Key keys={keys} quiet decorative />}
    </Button>
  );
}

/** "Open cache.ts at r5": the file whole, at the newest push the tab shows. */
function LatestButton({ tab, path }: { tab: string; path: string }) {
  const pull = usePull(tab);
  const known = useTabState(revisions, tab);
  const head = pull?.shown ?? undefined;
  if (head === undefined) return null;
  const number = revisionAt(known, head)?.number;
  return (
    <Button size="sm" onClick={() => showFile('whole', tab, path)}>
      Open {nameOf(path)} at {number === undefined ? shortId(head) : `r${number}`}
    </Button>
  );
}
