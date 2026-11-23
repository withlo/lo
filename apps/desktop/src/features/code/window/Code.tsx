// What code features draw: the frame of a peek, in the parts its code view makes for it; the
// references panel, in the right panel; the card over a word, which never takes focus; the outline's
// palette; and what the status bar says when a key finds nothing.

import {
  HintButton,
  HintRow,
  Palette,
  PaletteHint,
  PeekFoot,
  PeekHead,
  PeekList,
  ReferencesHead,
  ReferencesList,
  reveal,
  SourceMark,
  Spinner,
  StatusItem,
  Tag,
  TypeHover,
} from '@lo/ui';
import { keyLabels, parseKeys, setScopeSource, systemStrokes } from '@lo/ui/commands';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import {
  answerKey,
  candidatesOf,
  cardOf,
  filesIn,
  filterOutline,
  groupsOf,
  isOutside,
  metaOf,
  outlineRows,
  peekSource,
  sourceOf,
  type OutlineRow,
} from './answers.ts';
import {
  closeHover,
  closeOutline,
  closePeek,
  goToAnswer,
  goToReference,
  hovers,
  listed,
  outlineClosed,
  outlines,
  peeks,
  pickAnswer,
  typeOutline,
  type OpenPeek,
} from './navigate.ts';
import { said } from './said.ts';

/** The first key `id` has now, as this system shows it, if it has one. */
function keysOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** A key written in Lo's notation, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** Two commands' first keys side by side, as `j k` for the next and the previous. */
function pairOf(next: string, previous: string): string[] | undefined {
  const a = keysOf(next);
  const b = keysOf(previous);
  return a && b ? [...a, ...b] : undefined;
}

/** A peek's frame, drawn in its parts: the head, the list of answers and the foot. */
function PeekFrame({ open }: { open: OpenPeek }) {
  useKeys();
  const { parts, found, shown } = open;
  const candidates = useMemo(() => candidatesOf(found.answers), [found]);
  const source = useMemo(() => peekSource(found), [found]);
  if (!parts) return null;
  const answer = found.answers[shown];
  const keys = {
    move: pairOf('code.nextAnswer', 'code.previousAnswer'),
    go: keysOf('code.goAnswer'),
    references: keysOf('code.references'),
    back: keysOf('keys.back'),
    close: keysOf('code.closePeek'),
  };
  const inDiff = open.inDiff.get(shown) ?? false;
  return (
    <>
      {createPortal(
        <PeekHead
          name={found.name}
          count={found.answers.length}
          at={open.revision}
          goLabel={inDiff ? 'Show in diff' : 'Open whole file'}
          goes={answer !== undefined && !isOutside(answer)}
          source={source?.source}
          note={source?.note}
          keys={keys}
          onGo={() => goToAnswer(open)}
          onClose={() => closePeek(open)}
        />,
        parts.head,
      )}
      {createPortal(
        <PeekList
          candidates={candidates}
          selected={candidates[shown]?.key}
          onPick={(key) => {
            const index = candidates.findIndex((each) => each.key === key);
            if (index >= 0) pickAnswer(open, index);
          }}
          className="outline-none"
        />,
        parts.list,
      )}
      {createPortal(
        <PeekFoot
          meta={answer && metaOf(answer, open.revision)}
          several={found.answers.length > 1}
          keys={keys}
        />,
        parts.foot,
      )}
    </>
  );
}

/** Every peek's frame, each in the parts its code view made. */
function PeekFrames() {
  const open = useStore(peeks);
  return [...open.values()].map((each) => <PeekFrame key={each.tab} open={each} />);
}

/** The references panel, in the right panel: the word's references, a group for each file. */
export function ReferencesPanel({ tab }: { tab: PullTab }): ReactNode {
  useKeys();
  const list = useTabState(listed, tab.id);
  const groups = useMemo(() => (list ? groupsOf(list.found.answers, list.texts) : []), [list]);
  const stop = useRef<(() => void) | undefined>(undefined);
  // What its keys act on: the reference the keyboard is on, which they find themselves.
  const scope = useCallback((element: HTMLDivElement | null) => {
    stop.current?.();
    stop.current = element
      ? setScopeSource(element, { target: () => ({ kind: 'none' }) })
      : undefined;
  }, []);
  const answers = list?.found.answers ?? [];
  const focused = list && answers[list.focused];
  const focusedKey = focused && answerKey(focused, list.focused);
  const current = list?.current;
  const currentAnswer = current === undefined ? undefined : answers[current];
  const currentKey =
    current !== undefined && currentAnswer ? answerKey(currentAnswer, current) : undefined;
  // The reference the keyboard is on stays in view as the keyboard moves it.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = box.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    if (row) reveal(row);
  }, [focusedKey]);
  const first = answers[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-lo-references={tab.id}>
      <div className="flex flex-none items-center gap-6 ps-16 pe-8 pt-12 pb-8">
        <h2 className="label-caps text-fg-muted text-label">References</h2>
      </div>
      {list && first && (
        <ReferencesHead
          name={list.found.name}
          count={answers.length}
          files={filesIn(answers)}
          source={sourceOf(first).source}
          at={list.revision}
          fallback={list.found.fallback}
          outside={list.found.outside}
        />
      )}
      {list?.found.more && (
        <p className="m-0 px-16 pb-8 text-fg-muted text-small">
          First {answers.length.toLocaleString('en-US')} references shown
        </p>
      )}
      <div ref={box} className="min-h-0 flex-1 overflow-auto">
        <ReferencesList
          listRef={scope}
          groups={groups}
          focused={focusedKey}
          current={currentKey}
          onGo={(key) => {
            const index = answers.findIndex((answer, at) => answerKey(answer, at) === key);
            if (index >= 0) goToReference(tab.id, index);
          }}
          empty="No references listed"
          className="outline-none"
          data-lo-scope="references"
        />
      </div>
      {/* One line always: each hint is a button that runs its command, and a foot too narrow for
          its key chips gives them up, each hint giving its key in its tooltip. */}
      <div className="flex-none border-t border-border-subtle">
        <HintRow className="min-w-0 items-center gap-2 px-8 py-4 text-fg-muted text-small">
          <HintButton command="code.nextReference">Next</HintButton>
          <HintButton command="code.previousReference">Previous</HintButton>
          <HintButton command="code.goReference">Go to reference</HintButton>
          <HintButton command="code.closeReferences">Close</HintButton>
        </HintRow>
      </div>
    </div>
  );
}

/** How far below a word its card sits, and how close to the window's edges it goes, in pixels. */
const GAP = 4;
const EDGE = 16;

/** The card over a word, under it, or over it where the window's foot leaves no room. */
function HoverCard() {
  useKeys();
  const shown = useStore(hovers);
  const drawn = useMemo(() => (shown ? cardOf(shown.hover) : undefined), [shown]);
  const card = useRef<HTMLDivElement>(null);
  // Placed once it's drawn, and so measured: under the word, or over it where there's no room.
  useEffect(() => {
    const element = card.current;
    if (!element || !shown) return;
    const { anchor } = shown;
    const height = element.offsetHeight;
    const width = element.offsetWidth;
    const below = anchor.bottom + GAP + height <= window.innerHeight - EDGE;
    const top = below ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - GAP - height);
    const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - EDGE - width));
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
    element.style.visibility = 'visible';
  }, [shown]);
  if (!shown || !drawn) return null;
  const { hover } = shown;
  const { source } = sourceOf(hover);
  return (
    <div
      ref={card}
      className="invisible fixed z-popover"
      onPointerLeave={() => closeHover()}
      data-lo-hover
    >
      <TypeHover
        signature={drawn.signature}
        docs={drawn.docs}
        source={source}
        fallback={hover.fallback}
        location={hover.at && { path: hover.at.path, line: hover.at.line }}
        keys={{ definition: keysOf('code.definition'), close: keysOf('keys.escape') }}
      />
    </div>
  );
}

const OUTLINE_ICON = (
  <svg className="lo-i text-fg-muted" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 4h10M5.5 8H13M5.5 12H13" />
  </svg>
);

/** A symbol's row: as deep as it's nested, what it is, its name, and its line. */
function OutlineItem({ row }: { row: OutlineRow }) {
  return (
    <>
      <span
        className="flex-none"
        style={{ width: `calc(${row.depth} * var(--lo-sp-16))` }}
        aria-hidden="true"
      />
      <Tag>{row.symbol.kind}</Tag>
      <span className="min-w-0 truncate code-text">{row.symbol.name}</span>
      <span className="lo-num ms-auto flex-none text-fg-muted text-small">{row.symbol.line}</span>
    </>
  );
}

/** The outline's palette: the file's symbols, nested, found as you type; `⏎` goes to one. */
function OutlinePalette() {
  useKeys();
  const state = useStore(outlines);
  const rows = useMemo(() => outlineRows(state?.outline?.symbols ?? []), [state?.outline]);
  const shown = useMemo(() => filterOutline(rows, state?.query ?? ''), [rows, state?.query]);
  if (!state) return null;
  const typed = state.query.trim() !== '';
  const found = state.outline;
  const empty =
    state.problem ??
    (found === undefined ? (
      <span className="inline-flex items-center gap-8">
        <Spinner size="xs" />
        Reading symbols…
      </span>
    ) : typed ? (
      `No symbols match “${state.query.trim()}”`
    ) : (
      'No symbols in this file'
    ));
  return (
    <Palette<OutlineRow>
      open={state.open}
      onOpenChange={(next) => {
        if (!next) closeOutline();
      }}
      onClosed={outlineClosed}
      label="Outline"
      placeholder="Filter by name"
      icon={OUTLINE_ICON}
      query={state.query}
      onQueryChange={typeOutline}
      groups={[{ items: shown }]}
      itemId={(row) => row.key}
      onRun={(row) => closeOutline({ line: row.symbol.line, column: row.symbol.column })}
      renderItem={(row) => <OutlineItem row={row} />}
      empty={empty}
      foot={
        <>
          <span className="lo-num">
            {state.outline ? symbolCount(typed ? shown.length : undefined, rows.length) : ''}
          </span>
          {state.outline?.more && <span className="min-w-0">First 5,000 symbols shown</span>}
          {/* Where they came from, cut short rather than taking a line of its own. */}
          <span className="flex min-w-0 flex-1 basis-0">
            {found && (
              <SourceMark
                source={
                  found.source === 'server' && found.label !== undefined
                    ? { kind: 'server', name: found.label }
                    : { kind: 'syntax' }
                }
                note={found.fallback}
              />
            )}
          </span>
          <PaletteHint keys={labels('enter')}>Go</PaletteHint>
        </>
      }
      container={document.getElementById('root')}
    />
  );
}

/** How many symbols the outline lists, as a part of them while a name is typed: "41 / 214 symbols". */
function symbolCount(shown: number | undefined, all: number): string {
  const noun = all === 1 ? 'symbol' : 'symbols';
  const total = all.toLocaleString('en-US');
  return shown === undefined
    ? `${total} ${noun}`
    : `${shown.toLocaleString('en-US')} / ${total} ${noun}`;
}

/** What code features draw over the window: peeks' frames, the card over a word and the outline. */
export function CodeOverlays(): ReactNode {
  return (
    <>
      <PeekFrames />
      <HoverCard />
      <OutlinePalette />
    </>
  );
}

/** What the status bar says when a key finds nothing, for a few seconds. */
export function SaidStatus({ tab }: { tab: PullTab }): ReactNode {
  const message = useTabState(said, tab.id);
  return (
    <span role="status" className="inline-flex min-w-0">
      {message && (
        <StatusItem key={message.count} dot="idle">
          <span className="truncate">{message.text}</span>
        </StatusItem>
      )}
    </span>
  );
}
