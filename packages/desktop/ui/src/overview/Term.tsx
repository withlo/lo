import { PreviewCard } from '@base-ui/react/preview-card';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import type { Definition, Overview, TermTarget } from '@lo/artifact';

import { Key } from '../Key.tsx';
import { drawInlines, useRendering, type Rendering } from '../markdown/index.ts';
import { useGlossary } from './terms.ts';

/** How long the pointer rests on a term before its card opens, and leaves before it closes. */
export const HOVER_OPEN_MS = 300;
export const HOVER_CLOSE_MS = 150;

/** How each term whose card is open closes it, as `Esc` does. */
const openCards = new Set<() => void>();

/**
 * Closes every term's card that's open, as `Esc` on its term does, and says whether one was: for a
 * window whose own `Esc` comes first, so a card closes before focus goes anywhere. A term that has
 * focus keeps it, and its card stays closed until focus leaves it or the pointer opens it again.
 */
export function closeCards(): boolean {
  const closers = [...openCards];
  for (const close of closers) close();
  return closers.length > 0;
}

/**
 * A use of a defined term: a dotted underline, and a card with its definition while the pointer
 * rests on it or it has focus. `⏎`, or a click, goes to its entry in the glossary; `Esc` closes the
 * card until focus leaves the term or the pointer opens it again. The card never takes focus and
 * holds nothing that can, so `Tab` goes on from the term to whatever follows it. It copies the
 * glossary, which holds the definition whole and describes the term to screen readers.
 */
export function Term({ term, children }: { term: TermTarget; children: ReactNode }) {
  const { glossary, container } = useGlossary();
  const r = useRendering<Overview>();
  const element = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // While the term has focus, its card stays, wherever the pointer goes.
  const focused = useRef(false);
  // `Esc` closed the card, and focus hasn't left the term since: what stops watching for it to.
  const dismissed = useRef<(() => void) | undefined>(undefined);

  function undismiss(): void {
    dismissed.current?.();
    dismissed.current = undefined;
  }

  /**
   * Keeps the card closed until focus leaves the term. While the window is away the term has had
   * its blur, so focus a script moves elsewhere meanwhile is seen where it lands, as it lands or
   * once the window is back, whichever the browser says: either way, not on the term.
   */
  function dismiss(): void {
    const own = element.current;
    if (dismissed.current || !own) return;
    const page = own.ownerDocument;
    const view = page.defaultView;
    const left = () => {
      if (page.activeElement !== own) undismiss();
    };
    page.addEventListener('focusin', left, true);
    view?.addEventListener('focus', left);
    dismissed.current = () => {
      page.removeEventListener('focusin', left, true);
      view?.removeEventListener('focus', left);
    };
  }

  function show(next: boolean): void {
    if (next) undismiss();
    setOpen(next);
  }

  function now(next: boolean): void {
    clearTimeout(timer.current);
    show(next);
  }

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      dismissed.current?.();
    },
    [],
  );
  // While the card is open, the window's own `Esc` can close it, as the term's does.
  useEffect(() => {
    if (!open) return undefined;
    const close = () => {
      now(false);
      if (focused.current) dismiss();
    };
    openCards.add(close);
    return () => {
      openCards.delete(close);
    };
  });
  const definition = glossary.definition(term.key);
  if (!definition) return children;

  const later = (next: boolean, wait: number) => {
    clearTimeout(timer.current);
    if (!next && focused.current) return;
    timer.current = setTimeout(() => show(next), wait);
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
          if (!dismissed.current) now(true);
        }}
        onBlur={(event) => {
          focused.current = false;
          // The window losing focus blurs the term but leaves it the focused element, and gives it
          // focus again when the window comes back: a card closed with `Esc` stays closed. Only
          // focus moving elsewhere undoes the `Esc`.
          if (event.currentTarget.ownerDocument.activeElement !== event.currentTarget) {
            undismiss();
          }
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
            dismiss();
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
