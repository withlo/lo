// An overview Lo shows: the document, with who wrote it and for which revision above it, each
// figure as the check left it, and each code block and walkthrough filled in from the local copy
// (`Code.tsx`). It's first seen once the code blocks and figures near the screen have drawn, with
// the local copy if it's coming, within the bound for each (`drawing.ts`); a figure still being
// read then says so, and fills in keeping what's on screen where it is, as code does (`Held`).
// Every block is keyed by the parsed tree's own objects, which stay the same for as long as the
// overview's commit is on screen, so nothing is drawn again from scratch under the reader.

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
import { generationOf, MarkdownBlocks, secureLink, useRendering } from '@lo/ui/markdown';
import {
  Held,
  OverviewDocument,
  blockHints,
  lineRange,
  useNearness,
  type BlockHint,
  type OverviewTarget,
  type OverviewViews,
} from '@lo/ui/overview';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';

import { followLink } from '../../open/window/shared.ts';
import { afterHold } from '../../revisions/window/shared.ts';
import { MiddlePlaceholder, usePull, useTabState, type PullTab } from '../../tab/window/shared.ts';
import type { OverviewCommit, OverviewFile } from '../contract.ts';
import { targetsOf } from './targets.ts';
import { codeAt } from './blocks.ts';
import { ExcerptBlock, WalkthroughBlock, type CodeContext } from './Code.tsx';
import { drawing as firstDraw, FirstDrawContext, useFirstDraw } from './drawing.ts';
import { revisionAt, type Standing } from './facts.ts';
import { drawnIn, followCode, loadNewer, recordFrom } from './follow.ts';
import { useNow } from './hooks.ts';
import { openings } from './opening.ts';
import { OutOfDateBanner } from './OutOfDate.tsx';
import { AuthorPicture, WhoWrote } from './Author.tsx';
import { ago, authorOf, shortId } from './says.ts';
import { codeBlocksIn, staleAgainst } from './stale.ts';
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

/**
 * One figure, as its check left it, with an image's bytes as main read them (`file`), or none yet
 * while it's `coming`. Near the screen as the overview is first laid out, one still coming holds
 * the first frame back, within the bound; then it fills in as it comes, held where it would move
 * what's on screen.
 */
function ShownFigure({
  node,
  at,
  checked,
  file,
  coming,
}: {
  node: FigureNode;
  at: number | undefined;
  checked: readonly CheckedFigure[];
  file: OverviewFile | undefined;
  coming: boolean;
}) {
  const found = at === undefined ? undefined : checked[at];
  // A figure the check didn't read for this block is left out, as one it couldn't read.
  const figure = found?.reference.path === node.path ? found.figure : UNREAD;
  const box = useRef<HTMLDivElement>(null);
  const nearness = useNearness(box);
  const first = useFirstDraw();
  const drawn = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    if (!coming) return undefined;
    const done = first?.begin();
    drawn.current = done;
    return () => {
      drawn.current = undefined;
      done?.();
    };
  }, [first, coming]);
  useEffect(() => {
    if (nearness === 'far') drawn.current?.();
  }, [nearness]);
  const bytes = file?.kind === 'file' && file.bytes ? ownBytes(file.bytes) : undefined;
  const parts = useMemo<PartLink[]>(
    () => node.parts.map((part) => ({ id: part.id, label: partLabel(part.target) })),
    [node.parts],
  );
  const rendering = useRendering<Overview>();
  // A part goes where it points, as a link in the overview does.
  const follow = useCallback(
    (link: PartLink, from: Element) => {
      const target = node.parts.find((part) => part.id === link.id)?.target;
      const followed = target && partTarget(target);
      if (followed) rendering.follow(followed, from);
    },
    [node.parts, rendering],
  );
  return (
    <Held>
      <div ref={box}>
        <Figure
          path={node.path}
          figure={figure}
          reading={coming}
          bytes={figure.state === 'kept' && figure.type !== 'svg' ? bytes : undefined}
          number={(at ?? 0) + 1}
          caption={<MarkdownBlocks<Overview> blocks={node.caption} />}
          parts={parts}
          onFollow={follow}
        />
      </div>
    </Held>
  );
}

/** Where a figure's part goes, as a link's target: a web page only when Lo may open it. */
function partTarget(target: FigurePart['target']): OverviewTarget | undefined {
  if (target.kind !== 'web') return target;
  const url = secureLink(target.url);
  return url === undefined ? undefined : { kind: 'web', url };
}

/** What a focused block's chip says: while the code is beside, `o` closes it. */
function besideHints(block: Parameters<typeof blockHints>[0]): readonly BlockHint[] {
  return blockHints(block).map((hint) =>
    hint.label === 'Open beside' ? { ...hint, label: 'Close beside' } : hint,
  );
}

/**
 * Who wrote the overview and when, which revision it describes, and a newer one, when pushed: as
 * tall with the offer as without it, at any width, so nothing under it moves as the offer comes,
 * nor as who wrote it does, which main reads after the rest.
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
  const { byline } = commit;
  const author = byline && authorOf(byline);
  const revision = revisionAt(known, described)?.number;
  return (
    <div className="lo-ov-bylines" data-lo-byline>
      <div className="lo-ov-byline">
        {author && byline ? (
          <>
            <AuthorPicture author={author} />
            <span className="lo-ov-byline__who">
              <WhoWrote author={author} when={ago(byline.at, now)} />
            </span>
            <span className="lo-ov-byline__dot" aria-hidden="true">
              ·
            </span>
          </>
        ) : (
          // The picture's room, kept for it.
          <span className="size-20" aria-hidden="true" />
        )}
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
      <Button size="sm" variant="ghost" onClick={() => loadNewer(tab)}>
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
  focused,
  beside = false,
}: {
  tab: PullTab;
  standing: ShownStanding;
  scroller?: Ref<HTMLDivElement> | undefined;
  /** Whether the overview is the middle view on screen, rather than kept drawn behind another. */
  onScreen?: boolean;
  /** The block that shows its ring and its keys, by its number. */
  focused?: number | undefined;
  /** Whether the code is beside it, which takes the outline's room. */
  beside?: boolean;
}) {
  const { parsed, result, commit, header } = standing;
  const { outcome } = result.checked;
  const checked = outcome.kind === 'shown' ? outcome.figures : NO_FIGURES;
  const code = outcome.kind === 'shown' ? outcome.code : NO_CODE;
  const { figures: files, coming: figuresComing } = result;
  const index = useMemo(() => figuresIn(parsed.tree), [parsed.tree]);
  const figure = useCallback(
    (node: FigureNode) => (
      <ShownFigure
        node={node}
        at={index.get(node)}
        checked={checked}
        file={files.get(node.path)}
        coming={figuresComing.includes(node.path)}
      />
    ),
    [index, checked, files, figuresComing],
  );
  // The head on screen, when the overview was written for another commit.
  const head = staleAgainst(header.commit, usePull(tab.id));
  // How each block's code stands, the same object for as long as the check's result is.
  const context = useMemo<CodeContext>(
    () => ({
      tab: tab.id,
      pull: tab,
      tree: generationOf(parsed.tree),
      commit: header.commit,
      head,
      read: result.code,
      target: targetsOf(code, result.code),
    }),
    [tab, parsed.tree, header.commit, head, result.code, code],
  );
  // The lines the code blocks show that the check found, which the banner counts the changed of.
  const blocks = useMemo(() => codeBlocksIn(parsed.tree), [parsed.tree]);
  const targets = useMemo(
    () => blocks.filter((target) => context.target(target).code.state === 'resolved'),
    [blocks, context],
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
  // A link followed: code goes to the diff; a section or a term, which the overview has brought
  // on screen, leaves its block in the tab's history for `⌃o`; and a web page opens through main,
  // in a tab when it's a pull request, only when it's `https://`.
  const tabId = tab.id;
  const follow = useCallback(
    (target: OverviewTarget, from: Element) => {
      if (target.kind === 'web') {
        const url = secureLink(target.url);
        if (url !== undefined) void followLink(url);
        return;
      }
      const overview = drawnIn(tabId);
      if (!overview) return;
      if (target.kind === 'code') followCode(overview, from, codeAt(target));
      else if (target.kind === 'term' || target.kind === 'anchor') recordFrom(overview, from);
    },
    [tabId],
  );
  // Seen once the code blocks near the screen have drawn, with the local copy if it's coming, or at
  // the bound, counted from when the tab opened and never again; until then, the tab's placeholder.
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
    return afterHold(openings.get(tab.id).since ?? Date.now(), () => first.open());
  }, [first, tab.id]);
  return (
    <FirstDrawContext value={first}>
      <div className="relative h-full">
        <OverviewDocument
          ref={scroller}
          tree={parsed.tree}
          byline={<Byline tab={tab} commit={commit} described={header.commit} />}
          banner={
            head !== undefined && (
              <OutOfDateBanner tab={tab} standing={standing} head={head} targets={targets} />
            )
          }
          views={views}
          drawing={drawing}
          focused={focused}
          outline={!beside}
          hints={beside ? besideHints : undefined}
          onFollow={follow}
        />
        {drawing && (
          <div className="absolute inset-0">
            <MiddlePlaceholder tab={tab} />
          </div>
        )}
      </div>
    </FirstDrawContext>
  );
}
