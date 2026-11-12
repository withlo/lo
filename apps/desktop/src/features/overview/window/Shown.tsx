// An overview Lo shows: the document, with who wrote it and for which revision above it, each
// figure as the check left it, and each code block and walkthrough filled in from the local copy
// (`Code.tsx`). It's first seen once the code blocks near the screen have drawn, with the local
// copy if it's coming, within the bound for each (`drawing.ts`). Every block is keyed by the parsed
// tree's own objects, which stay the same for as long as the overview's commit is on screen, so
// nothing is drawn again from scratch under the reader.

import type {
  CheckedCode,
  CheckedFigure,
  Excerpt,
  Figure as FigureNode,
  FigureState,
  FigurePart,
  Overview,
  Walkthrough as WalkthroughNode,
} from '@lo/artifact';
import { Button } from '@lo/ui';
import { Figure, type PartLink } from '@lo/ui/figures';
import { MarkdownBlocks } from '@lo/ui/markdown';
import { OverviewDocument, lineRange, type OverviewViews } from '@lo/ui/overview';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';

import { HOLD_LIMIT } from '../../revisions/contract.ts';
import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import type { OverviewCommit, OverviewFile } from '../contract.ts';
import { targetsOf } from './targets.ts';
import { ExcerptBlock, WalkthroughBlock, type CodeContext } from './Code.tsx';
import { drawing as firstDraw, FirstDrawContext } from './drawing.ts';
import { revisionAt, type Standing } from './facts.ts';
import { useNow } from './hooks.ts';
import { main } from './main.ts';
import { AuthorPicture, WhoWrote } from './Author.tsx';
import { ago, authorOf, shortId } from './says.ts';
import { revisions, states } from './store.ts';

type ShownStanding = Extract<Standing, { kind: 'shown' }>;

const NO_FIGURES: readonly CheckedFigure[] = [];
const NO_CODE: readonly CheckedCode[] = [];

/** What a figure the check didn't read for its block shows as. */
const UNREAD: FigureState = { state: 'unread', why: 'failed' };

/** Bytes main sent, as the figure takes them: on an `ArrayBuffer` of their own, copied once. */
const owned = new WeakMap<Uint8Array, Uint8Array<ArrayBuffer>>();

function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (isOwn(bytes)) return bytes;
  let copy = owned.get(bytes);
  if (!copy) {
    copy = new Uint8Array(bytes);
    owned.set(bytes, copy);
  }
  return copy;
}

function isOwn(bytes: Uint8Array): bytes is Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer;
}

/**
 * Each `:::figure` block in `tree`, by its place among them, in the order they're written: the
 * order the parse lists the figures the check read. It walks with an explicit stack, so no tree can
 * overflow it.
 */
export function figuresIn(tree: object): ReadonlyMap<FigureNode, number> {
  const found = new Map<FigureNode, number>();
  const stack: unknown[] = [tree];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null) continue;
    if (Array.isArray(value)) {
      for (let at = value.length - 1; at >= 0; at--) stack.push(value[at]);
      continue;
    }
    if (isFigure(value)) found.set(value, found.size);
    const fields = Object.values(value);
    for (let at = fields.length - 1; at >= 0; at--) stack.push(fields[at]);
  }
  return found;
}

function isFigure(value: object): value is FigureNode {
  return (
    Reflect.get(value, 'kind') === 'figure' &&
    typeof Reflect.get(value, 'path') === 'string' &&
    Array.isArray(Reflect.get(value, 'caption'))
  );
}

/** Where a figure's part goes, in words, for its link's name. */
function partLabel(target: FigurePart['target']): string {
  switch (target.kind) {
    case 'code':
      return target.lines ? `${target.path}, ${lineRange(target.lines)}` : target.path;
    case 'term':
      return `The term ${target.key}`;
    case 'anchor':
      return `The section ${target.name}`;
    case 'web':
      return target.url;
    default:
      target satisfies never;
      return 'A part of the figure';
  }
}

/** One figure, as its check left it, with an image's bytes as main read them. */
function ShownFigure({
  node,
  at,
  checked,
  files,
}: {
  node: FigureNode;
  at: number | undefined;
  checked: readonly CheckedFigure[];
  files: ReadonlyMap<string, OverviewFile>;
}) {
  const found = at === undefined ? undefined : checked[at];
  // A figure the check didn't read for this block is left out, as one it couldn't read.
  const figure = found?.reference.path === node.path ? found.figure : UNREAD;
  const file = files.get(node.path);
  const bytes = file?.kind === 'file' && file.bytes ? ownBytes(file.bytes) : undefined;
  const parts = useMemo<PartLink[]>(
    () => node.parts.map((part) => ({ id: part.id, label: partLabel(part.target) })),
    [node.parts],
  );
  return (
    <Figure
      path={node.path}
      figure={figure}
      bytes={figure.state === 'kept' && figure.type !== 'svg' ? bytes : undefined}
      number={(at ?? 0) + 1}
      caption={<MarkdownBlocks<Overview> blocks={node.caption} />}
      parts={parts}
    />
  );
}

/**
 * Who wrote the overview and when, which revision it describes, and a newer one, when pushed: as
 * tall with the offer as without it, at any width, so nothing under it moves as the offer comes.
 * Where the article is too narrow for the offer beside the rest, the offer has a line of its own,
 * kept free for it, and narrower still, so has what it describes. Who wrote it gives up its room
 * first, clipped, then the offer's words and what it describes; the way to load it never does.
 */
function Byline({
  tab,
  commit,
  described,
}: {
  tab: PullTab;
  commit: OverviewCommit;
  described: string;
}) {
  const state = useTabState(states, tab.id);
  const known = useTabState(revisions, tab.id);
  // The time it was written ages as the overview stays on screen.
  const now = useNow(true, 60_000);
  const author = authorOf(commit.byline);
  const revision = revisionAt(known, described)?.number;
  return (
    <div className="lo-ov-bylines" data-lo-byline>
      <div className="lo-ov-byline">
        <AuthorPicture author={author} />
        <span className="lo-ov-byline__who">
          <WhoWrote author={author} when={ago(commit.byline.at, now)} />
        </span>
        <span className="lo-ov-byline__dot" aria-hidden="true">
          ·
        </span>
        <span className="lo-ov-byline__said">
          describes {revision !== undefined && <strong>r{revision}</strong>}{' '}
          <span className="lo-commit" title={described}>
            {shortId(described)}
          </span>
          {commit.source === 'fork' && (
            <>
              <span className="lo-ov-byline__dot" aria-hidden="true">
                ·
              </span>
              From the fork
            </>
          )}
        </span>
        {state?.newer && <NewerOffer tab={tab.id} />}
      </div>
    </div>
  );
}

/** "A newer overview was pushed · Load it": the newer one goes on screen only when asked. */
export function NewerOffer({ tab }: { tab: string }) {
  return (
    <span className="lo-ov-byline__end lo-ov-offer items-center" role="status">
      <span className="lo-ov-offer__text">
        A newer overview was pushed
        <span className="lo-ov-offer__dot" aria-hidden="true">
          ·
        </span>
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          main()
            .load({ id: tab })
            .catch((error: unknown) =>
              console.error("Lo couldn't load the newer overview:", error),
            );
        }}
      >
        Load it
      </Button>
    </span>
  );
}

export function Shown({
  tab,
  standing,
  scroller,
  onScreen = true,
}: {
  tab: PullTab;
  standing: ShownStanding;
  scroller?: Ref<HTMLDivElement> | undefined;
  /** Whether the overview is the middle view on screen, rather than kept drawn behind another. */
  onScreen?: boolean;
}) {
  const { parsed, result, commit, header } = standing;
  const { outcome } = result.checked;
  const checked = outcome.kind === 'shown' ? outcome.figures : NO_FIGURES;
  const code = outcome.kind === 'shown' ? outcome.code : NO_CODE;
  const files = result.figures;
  const index = useMemo(() => figuresIn(parsed.tree), [parsed.tree]);
  const figure = useCallback(
    (node: FigureNode) => (
      <ShownFigure node={node} at={index.get(node)} checked={checked} files={files} />
    ),
    [index, checked, files],
  );
  // How each block's code stands, the same object for as long as the check's result is.
  const context = useMemo<CodeContext>(
    () => ({
      tab: tab.id,
      commit: header.commit,
      read: result.code,
      target: targetsOf(code, result.code),
    }),
    [tab.id, header.commit, result.code, code],
  );
  const excerpt = useCallback(
    (node: Excerpt) => <ExcerptBlock node={node} context={context} />,
    [context],
  );
  const walkthrough = useCallback(
    (node: WalkthroughNode) => <WalkthroughBlock node={node} context={context} />,
    [context],
  );
  const views = useMemo<OverviewViews>(
    () => ({ figure, excerpt, walkthrough }),
    [figure, excerpt, walkthrough],
  );
  // Seen once the code blocks near the screen have drawn, or at the bound; while the local copy is
  // coming, they wait for it too, and once it's in, they have the bound again to draw.
  const [drawing, setDrawing] = useState(true);
  const [first] = useState(() => firstDraw(() => setDrawing(false)));
  const copy = useRef<(() => void) | undefined>(undefined);
  const coming = result.code.kind === 'waiting';
  useLayoutEffect(() => {
    if (coming) {
      copy.current ??= first.begin();
      return;
    }
    copy.current?.();
  }, [first, coming]);
  useLayoutEffect(() => {
    first.settle();
  }, [first]);
  // Far blocks draw for their height only once the overview is on screen, and blocks diff their
  // files here only then: before any block asks for its file.
  useLayoutEffect(() => {
    if (onScreen) first.show();
  }, [first, onScreen]);
  useLayoutEffect(() => {
    const bound = setTimeout(() => first.open(), HOLD_LIMIT);
    return () => clearTimeout(bound);
  }, [first, coming]);
  return (
    <FirstDrawContext value={first}>
      <OverviewDocument
        ref={scroller}
        tree={parsed.tree}
        byline={<Byline tab={tab} commit={commit} described={header.commit} />}
        views={views}
        drawing={drawing}
      />
    </FirstDrawContext>
  );
}
