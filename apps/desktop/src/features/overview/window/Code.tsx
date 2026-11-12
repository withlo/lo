// An overview's code blocks and walkthroughs, filled in from the pull request's local copy. Each
// block is laid out from what the overview says it points at, as tall as its lines, and keeps its
// height while it's on screen (`Held`), so code coming moves nothing above or below it. Near the
// screen, a block asks main for its file's text at the commit the overview describes, and, for a
// code block, where the pull request's diff of the file starts; the diff's background job diffs
// and highlights them; and the block draws its code once, when all of that is in. Far from the
// screen, it lets its code go. The window keeps no code but what's drawn.

import type { CodeRange, Excerpt, Walkthrough as WalkthroughNode } from '@lo/artifact';
import { Button, Key } from '@lo/ui';
import { createExcerptView, createFileView, type FileView } from '@lo/ui/code';
import {
  CodeBlock,
  CodeBody,
  CodeNote,
  Held,
  useNear,
  Walkthrough,
  type CodeBlockVariant,
} from '@lo/ui/overview';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { registry } from '../../../window/commands/registry.ts';
import { diffTexts } from '../../diff/window/shared.ts';
import { usePull, useTabState } from '../../tab/window/shared.ts';
import { findFile, showFile } from '../../tree/window/shared.ts';
import type { CodeRead } from './checking.ts';
import {
  excerptOf,
  nameOf,
  showsOf,
  textsOf,
  type Shows,
  type Target,
  type Words,
} from './targets.ts';
import { revisionAt } from './facts.ts';
import { keyOf } from './labels.ts';
import { main } from './main.ts';
import { usePage } from './page.ts';
import { shortId } from './says.ts';
import { revisions } from './store.ts';

/**
 * What the overview's blocks read their code with: the pull request's tab, the commit the overview
 * describes, how far its code was read, and how the check left each place it points at.
 */
export interface CodeContext {
  readonly tab: string;
  readonly commit: string;
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
  return (
    <Held>
      <CodeBlock target={target} variant={variant}>
        <CodeBody rows={rowsOf(target)}>
          {shows.kind === 'note' ? (
            <Note shows={shows} tab={context.tab} path={target.path} />
          ) : unread !== undefined ? (
            <CodeNote title="Lo couldn’t read this code.">{unread}</CodeNote>
          ) : (
            <ExcerptCode
              tab={context.tab}
              commit={context.commit}
              target={target}
              unread={failing}
            />
          )}
        </CodeBody>
      </CodeBlock>
    </Held>
  );
}

/** A code block's code: read near the screen, drawn once it's all in, let go far from it. */
function ExcerptCode({
  tab,
  commit,
  target,
  unread,
}: {
  tab: string;
  commit: string;
  target: CodeRange;
  unread: (why: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const near = useNear(box);
  const page = usePage();
  const id = `overview-code${useId()}`;
  const [drawn, setDrawn] = useState<ReturnType<typeof excerptOf> | undefined>(undefined);
  const { path } = target;
  const { start, end } = target.lines;
  // Who's told the code couldn't be read, which changes without asking for it again.
  const failed = useRef(unread);
  useLayoutEffect(() => {
    failed.current = unread;
  }, [unread]);

  useEffect(() => {
    if (!near) {
      setDrawn(undefined);
      return undefined;
    }
    const controller = new AbortController();
    void (async () => {
      const read = await main().texts({ id: tab, commit, path, base: true });
      if (controller.signal.aborted) return;
      if (read.kind === 'unread') {
        failed.current(read.why);
        return;
      }
      const [diffed] = await diffTexts([textsOf(path, read)], controller.signal).catch(
        (error: unknown) => {
          if (!controller.signal.aborted) console.error("Lo couldn't diff a code block:", error);
          return [undefined];
        },
      );
      if (!controller.signal.aborted) setDrawn(excerptOf(read, diffed));
    })().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      console.error("Lo couldn't read a code block's code:", error);
      failed.current(error instanceof Error ? error.message : String(error));
    });
    return () => controller.abort();
  }, [near, tab, commit, path]);

  useLayoutEffect(() => {
    const parent = box.current;
    if (!parent || !page || !drawn) return undefined;
    parent.style.minHeight = '';
    const keys = registry();
    const view = createExcerptView(
      parent,
      {
        id,
        path,
        lines: drawn.lines,
        diff: drawn.diff,
        range: { side: 'new', from: start, to: end },
        tokens: drawn.tokens,
        vimKeys: keys.vimKeys(),
        nonce: page.nonce,
      },
      QUIET,
    );
    const stop = keys.subscribe(() => view.setVimKeys(keys.vimKeys()));
    return () => {
      // Let go far from the screen, it keeps its room.
      parent.style.minHeight = `${parent.getBoundingClientRect().height}px`;
      stop();
      view.destroy();
    };
  }, [drawn, page, id, path, start, end]);

  return <div ref={box} data-lo-code={drawn ? 'drawn' : 'waiting'} />;
}

/** A `:::walkthrough` block: its steps beside the current one's file, its lines marked. */
export function WalkthroughBlock({
  node,
  context,
}: {
  node: WalkthroughNode;
  context: CodeContext;
}) {
  const [current, setCurrent] = useState(0);
  const at = Math.max(0, Math.min(current, node.steps.length - 1));
  const step = node.steps[at];
  const shows =
    step && showsOf(step.target, context.target(step.target), context.read, context.commit);
  return (
    <Held>
      <Walkthrough
        node={node}
        current={at}
        step={setCurrent}
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
  | { path: string; lines: string[]; tokens: Uint32Array | undefined }
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
  const id = `overview-step${useId()}`;
  const view = useRef<FileView>(undefined);
  const [file, setFile] = useState<StepFile | undefined>(undefined);
  const { path } = target;
  const { start, end } = target.lines;

  useEffect(() => {
    setFile(undefined);
    if (!near) return undefined;
    const controller = new AbortController();
    void (async () => {
      const read = await main().texts({ id: tab, commit, path, base: false });
      if (controller.signal.aborted) return;
      if (read.kind === 'unread') {
        setFile({ path, unread: read.why });
        return;
      }
      const [diffed] = await diffTexts(
        [{ path, old: null, new: read.text }],
        controller.signal,
      ).catch(() => [undefined]);
      if (controller.signal.aborted) return;
      const { lines, tokens } = excerptOf({ ...read, base: null }, diffed);
      setFile({ path, lines: lines.new, tokens: tokens.new });
    })().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setFile({ path, unread: error instanceof Error ? error.message : String(error) });
    });
    return () => controller.abort();
  }, [near, tab, commit, path]);

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
        tokens: lines.tokens,
        vimKeys: keys.vimKeys(),
        nonce: page.nonce,
      },
      QUIET,
    );
    view.current = made;
    const stop = keys.subscribe(() => made.setVimKeys(keys.vimKeys()));
    return () => {
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

/** What a block says in its code's place, with what the reader can do about it. */
function Note({
  shows,
  tab,
  path,
}: {
  shows: Extract<Shows, { kind: 'note' }>;
  tab: string;
  path: string;
}) {
  const { action } = shows;
  return (
    <CodeNote
      title={shows.title}
      action={
        action?.kind === 'find' ? (
          <FindButton name={action.name} />
        ) : action?.kind === 'latest' ? (
          <LatestButton tab={tab} path={path} />
        ) : undefined
      }
    >
      <Said words={shows.words} />
    </CodeNote>
  );
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
