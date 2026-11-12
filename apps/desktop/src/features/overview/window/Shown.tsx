// An overview Lo shows: the document, with who wrote it and for which revision above it, and each
// figure as the check left it. Code blocks and walkthroughs show what they point at until their
// code is read. Every block is keyed by the parsed tree's own objects, which stay the same for as
// long as the overview's commit is on screen, so nothing is drawn again from scratch under the
// reader.

import type {
  CheckedFigure,
  Figure as FigureNode,
  FigureState,
  FigurePart,
  Overview,
} from '@lo/artifact';
import { Button } from '@lo/ui';
import { Figure, type PartLink } from '@lo/ui/figures';
import { MarkdownBlocks } from '@lo/ui/markdown';
import { OverviewDocument, lineRange, type OverviewViews } from '@lo/ui/overview';
import { useCallback, useMemo, type Ref } from 'react';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import type { OverviewCommit, OverviewFile } from '../contract.ts';
import { revisionAt, type Standing } from './facts.ts';
import { useNow } from './hooks.ts';
import { main } from './main.ts';
import { AuthorPicture, WhoWrote } from './Author.tsx';
import { ago, authorOf, shortId } from './says.ts';
import { revisions, states } from './store.ts';

type ShownStanding = Extract<Standing, { kind: 'shown' }>;

const NO_FIGURES: readonly CheckedFigure[] = [];

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
 * Who wrote the overview and when, which revision it describes, and a newer one, when pushed: one
 * line, whatever its width, so nothing under it moves as the offer comes. Who wrote it gives up
 * its room first, clipped.
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
    <div className="lo-ov-byline" data-lo-byline>
      <AuthorPicture author={author} />
      <span className="lo-ov-byline__who">
        <WhoWrote author={author} when={ago(commit.byline.at, now)} />
      </span>
      <span aria-hidden="true">·</span>
      <span>
        describes {revision !== undefined && <strong>r{revision}</strong>}{' '}
        <span className="lo-commit" title={described}>
          {shortId(described)}
        </span>
      </span>
      {commit.source === 'fork' && (
        <>
          <span aria-hidden="true">·</span>
          <span>From the fork</span>
        </>
      )}
      {state?.newer && <NewerOffer tab={tab.id} />}
    </div>
  );
}

/** "A newer overview was pushed · Load it": the newer one goes on screen only when asked. */
export function NewerOffer({ tab }: { tab: string }) {
  return (
    <span className="lo-ov-byline__end items-center" role="status">
      A newer overview was pushed
      <span aria-hidden="true">·</span>
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
}: {
  tab: PullTab;
  standing: ShownStanding;
  scroller?: Ref<HTMLDivElement> | undefined;
}) {
  const { parsed, result, commit, header } = standing;
  const { outcome } = result.checked;
  const checked = outcome.kind === 'shown' ? outcome.figures : NO_FIGURES;
  const files = result.figures;
  const index = useMemo(() => figuresIn(parsed.tree), [parsed.tree]);
  const figure = useCallback(
    (node: FigureNode) => (
      <ShownFigure node={node} at={index.get(node)} checked={checked} files={files} />
    ),
    [index, checked, files],
  );
  const views = useMemo<OverviewViews>(() => ({ figure }), [figure]);
  return (
    <OverviewDocument
      ref={scroller}
      tree={parsed.tree}
      byline={<Byline tab={tab} commit={commit} described={header.commit} />}
      views={views}
    />
  );
}
