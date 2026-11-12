import { PreviewCard } from '@base-ui/react/preview-card';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import type { Definition, Overview, TermTarget } from '@lo/artifact';

import { Key } from '../Key.tsx';
import { drawInlines, useRendering, type Rendering } from '../markdown/index.ts';
import { useGlossary } from './terms.ts';

/** How long the pointer rests on a term before its card opens, and leaves before it closes. */
export const HOVER_OPEN_MS = 300;
export const HOVER_CLOSE_MS = 150;

/**
 * A use of a defined term: a dotted underline, and a card with its definition while the pointer
 * rests on it or it has focus. `⏎`, or a click, goes to its entry in the glossary; `Esc` closes the
 * card. The card never takes focus and holds nothing that can, so `Tab` goes on from the term to
 * whatever follows it. It copies the glossary, which holds the definition whole and describes the
 * term to screen readers.
 */
export function Term({ term, children }: { term: TermTarget; children: ReactNode }) {
  const { glossary, container } = useGlossary();
  const r = useRendering<Overview>();
  const element = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // While the term has focus, its card stays, wherever the pointer goes.
  const focused = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const definition = glossary.definition(term.key);
  if (!definition) return children;

  const now = (next: boolean) => {
    clearTimeout(timer.current);
    setOpen(next);
  };
  const later = (next: boolean, wait: number) => {
    clearTimeout(timer.current);
    if (!next && focused.current) return;
    timer.current = setTimeout(() => setOpen(next), wait);
  };
  const follow = (from: HTMLElement) => {
    now(false);
    r.follow(term, from);
  };

  return (
    <>
      <span
        ref={element}
        role="link"
        tabIndex={0}
        aria-describedby={glossary.definitionId(term.key)}
        className={open ? 'lo-term is-active' : 'lo-term'}
        onPointerEnter={() => later(true, HOVER_OPEN_MS)}
        onPointerLeave={() => later(false, HOVER_CLOSE_MS)}
        onFocus={() => {
          focused.current = true;
          now(true);
        }}
        onBlur={() => {
          focused.current = false;
          now(false);
        }}
        onClick={(event) => follow(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            follow(event.currentTarget);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            now(false);
          }
        }}
      >
        {children}
      </span>
      <HoverCard
        open={open}
        anchor={element}
        container={container}
        definition={definition}
        rendering={r}
        onClose={() => now(false)}
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={() => later(false, HOVER_CLOSE_MS)}
      />
    </>
  );
}

interface HoverCardProps {
  open: boolean;
  anchor: RefObject<HTMLSpanElement | null>;
  container: RefObject<HTMLElement | null>;
  definition: Definition;
  rendering: Rendering<Overview>;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/**
 * A term's card: its name, its definition's opening words, and the key to the glossary, which has
 * the rest. Base UI's preview card places it and closes it on `Esc` or a press elsewhere; unlike a
 * popover, it adds nothing focusable around the term.
 */
function HoverCard({
  open,
  anchor,
  container,
  definition,
  rendering,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: HoverCardProps) {
  return (
    <PreviewCard.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <PreviewCard.Portal container={container}>
        <PreviewCard.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-popover"
        >
          <PreviewCard.Popup
            // The glossary holds the same words, and describes the term to screen readers.
            aria-hidden="true"
            className="lo-popover lo-hovercard"
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
          >
            <div className="lo-hovercard__term">{definition.name}</div>
            <CardBody definition={definition} rendering={rendering} />
            <div className="lo-hovercard__foot">
              Glossary
              <span className="lo-hovercard__key">
                <Key keys={['⏎']} quiet decorative />
              </span>
            </div>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

/**
 * The definition's opening paragraph, as text only: its links show as their words, and nothing in
 * it has an id or takes focus. Headings, code, folds and the rest stay in the glossary, which the
 * card points to when there's more.
 */
function CardBody({
  definition,
  rendering,
}: {
  definition: Definition;
  rendering: Rendering<Overview>;
}) {
  const [first, ...rest] = definition.children;
  const copy = { ...rendering, interactive: false };
  if (first?.kind !== 'paragraph') {
    return <div className="lo-hovercard__body lo-hovercard__more">In the glossary.</div>;
  }
  return (
    <div className="lo-hovercard__body">
      {drawInlines(first.children, copy)}
      {rest.length > 0 && <span className="lo-hovercard__more"> More in the glossary.</span>}
    </div>
  );
}
