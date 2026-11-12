import { Popover } from '@base-ui/react/popover';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import type { Definition, Overview, TermTarget } from '@lo/artifact';

import { Key } from '../Key.tsx';
import { MarkdownBlocks, MarkdownProvider, useRendering } from '../markdown/index.ts';
import { useGlossary } from './terms.ts';

/** How long the pointer rests on a term before its card opens, and leaves before it closes. */
export const HOVER_OPEN_MS = 300;
export const HOVER_CLOSE_MS = 150;

/**
 * A use of a defined term: a dotted underline, and a card with its definition while the pointer
 * rests on it or it has focus. `⏎`, or a click, goes to its entry in the glossary; `Esc` closes the
 * card. The card copies the glossary, which holds the definition too, and which describes the term
 * for screen readers.
 */
export function Term({ term, children }: { term: TermTarget; children: ReactNode }) {
  const { glossary, container } = useGlossary();
  const r = useRendering<Overview>();
  const element = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const definition = glossary.definition(term.key);
  if (!definition) return children;

  const now = (next: boolean) => {
    clearTimeout(timer.current);
    setOpen(next);
  };
  const later = (next: boolean, wait: number) => {
    clearTimeout(timer.current);
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
        onFocus={() => now(true)}
        onBlur={() => now(false)}
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
  container: HTMLElement | null;
  definition: Definition;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/** A term's card: its name, its definition as the glossary has it, and the key to go there. */
function HoverCard({
  open,
  anchor,
  container,
  definition,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: HoverCardProps) {
  const r = useRendering<Overview>();
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Popover.Portal container={container}>
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-popover outline-none"
        >
          <Popover.Popup
            initialFocus={false}
            finalFocus={false}
            // The glossary holds the same words, and describes the term to screen readers.
            aria-hidden="true"
            className="lo-hovercard rounded-md bg-bg-overlay px-12 pt-12 pb-8 text-fg shadow-pop outline-none text-ui"
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
          >
            <div className="font-bold">{definition.name}</div>
            <div className="mt-4 space-y-6">
              {/* A copy, so its links are only their text. */}
              <MarkdownProvider rendering={{ ...r, interactive: false }}>
                <MarkdownBlocks blocks={definition.children} />
              </MarkdownProvider>
            </div>
            <div className="mt-8 flex items-center gap-8 border-t border-border-subtle pt-8 text-fg-muted text-small">
              Glossary
              <span className="ms-auto">
                <Key keys={['⏎']} quiet decorative />
              </span>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
