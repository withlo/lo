import { PreviewCard } from '@base-ui/react/preview-card';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import type { Definition, Overview, OverviewBlock, TermTarget } from '@lo/artifact';

import {
  FollowLink,
  MarkdownInlines,
  MarkdownProvider,
  useRendering,
  type Rendering,
} from '../markdown/index.ts';
import { TermCard } from './TermCard.tsx';
import { TERM_ATTRIBUTE, useGlossary, type TermMenu, type TermShown } from './terms.ts';

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

/** Whether a term's card is open, which {@link closeCards} would close. */
export function cardsOpen(): boolean {
  return openCards.size > 0;
}

/** Listens for nothing, for a term with no menu. */
function noMenus(): () => void {
  return () => undefined;
}

/**
 * Whether `menu` is open for the term `key` names, as `element` draws it, following it as it opens
 * and closes.
 */
function useMenuOpen(
  menu: TermMenu | undefined,
  key: string,
  element: RefObject<HTMLElement | null>,
): boolean {
  return useSyncExternalStore(
    menu?.subscribe ?? noMenus,
    () => menu?.isOpen(key, element.current) ?? false,
    () => false,
  );
}

/**
 * A use of a defined term: a dotted underline, and a card with its definition while the pointer
 * rests on it or it has focus. `⏎`, or a click, goes to its row in the glossary; `Esc` closes the
 * card until focus leaves the term or the pointer opens it again. The card never takes focus and
 * holds nothing that can, so `Tab` goes on from the term to whatever follows it: its links take a
 * click, and leave focus where it was. It copies the glossary, which holds the definition whole
 * and describes the term to screen readers. With the repo's definitions, it shows what the
 * overview shows for the term: the repo's definition or its own, its tags, the definition a
 * Changed term replaces, and who it's by. With a menu, the card has its `⋯`, and stays open while
 * the menu is. A term the reader ignores is plain text, its underline gone in a Tint.
 */
export function Term({ term, children }: { term: TermTarget; children: ReactNode }) {
  const { glossary, container, terms } = useGlossary();
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
  const shown = terms?.of(term.key);
  const ignored = shown?.ignored === true;
  const menu = terms?.menu;
  const menuOpen = useMenuOpen(menu, term.key, element);
  // Ignored, its card goes, and doesn't come back by itself once it's a term again.
  if (ignored && open) setOpen(false);
  useEffect(() => {
    if (!ignored) return;
    clearTimeout(timer.current);
    focused.current = false;
  }, [ignored]);
  // Only a term the overview's glossary lists has a row to go to, and is a stop for `Tab`: one only
  // the repo's definitions hold, which theirs can name, has its card under the pointer alone.
  const listed = glossary.termId(term.key) !== undefined;
  // A link in the card goes where it points as the term's own would, from the term: the card
  // closes first.
  const card = useMemo<Rendering<Overview>>(
    () => ({
      ...r,
      focusable: false,
      follow: (target, from) => {
        clearTimeout(timer.current);
        setOpen(false);
        r.follow(target, element.current ?? from);
      },
      extension: {
        ...r.extension,
        // A term in a definition is a link to its row, never a term with a card of its own, and
        // one the overview's glossary doesn't list, with no row to go to, or that the reader
        // ignores, is its words.
        link: (target, inner) =>
          target.kind === 'term' &&
          (glossary.termId(target.key) === undefined || terms?.of(target.key)?.ignored === true) ? (
            inner
          ) : (
            <FollowLink<Overview> target={target}>{inner}</FollowLink>
          ),
      },
    }),
    [r, glossary, terms],
  );
  if (!definition && !shown) return children;

  const later = (next: boolean, wait: number) => {
    clearTimeout(timer.current);
    if (!next && focused.current) return;
    timer.current = setTimeout(() => show(next), wait);
  };
  const follow = (from: HTMLElement) => {
    now(false);
    if (listed) r.follow(term, from);
  };

  // Its menu, from its card, which is put elsewhere in the page: a right-click there, or its `⋯`.
  const openMenu = (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || !menu) return;
    if (menu.open(term.key, element.current, { x: event.clientX, y: event.clientY })) {
      event.preventDefault();
    }
  };

  // Ignored, it's its words: the same element, so its underline goes in a Tint, and its card, if
  // it's open, goes as a card does.
  if (ignored) {
    return (
      <>
        <span ref={element} className="lo-term is-plain move-tint">
          {children}
        </span>
        <HoverCard
          open={false}
          anchor={element}
          container={container}
          definition={definition}
          shown={shown}
          rendering={card}
          menu={false}
          onClose={() => now(false)}
          onPointerEnter={() => undefined}
          onPointerLeave={() => undefined}
          onContextMenu={openMenu}
        />
      </>
    );
  }

  return (
    <>
      <span
        ref={element}
        role={listed ? 'link' : undefined}
        tabIndex={listed ? 0 : undefined}
        aria-describedby={glossary.definitionId(term.key)}
        {...{ [TERM_ATTRIBUTE]: term.key }}
        className={open || menuOpen ? 'lo-term is-active move-tint' : 'lo-term move-tint'}
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
        // It stays while its menu is open, wherever the pointer and focus have gone meanwhile.
        open={open || menuOpen}
        anchor={element}
        container={container}
        definition={definition}
        shown={shown}
        rendering={card}
        menu={menu !== undefined}
        onClose={() => now(false)}
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={() => later(false, HOVER_CLOSE_MS)}
        onContextMenu={openMenu}
      />
    </>
  );
}

interface HoverCardProps {
  open: boolean;
  anchor: RefObject<HTMLSpanElement | null>;
  container: RefObject<HTMLElement | null>;
  /** The overview's own definition, if its glossary has one. */
  definition: Definition | undefined;
  /** What the overview shows for the term with the repo's definitions, once it knows. */
  shown: TermShown | undefined;
  /** How the card draws what it shows: its links take a click, and no focus. */
  rendering: Rendering<Overview>;
  /** The term has a menu: the card draws its `⋯`, which opens it as a right-click does. */
  menu: boolean;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  /** A right-click on the card, or its `⋯`: the term's menu. */
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * A term's card (`TermCard`): its name and tags, its definition, the one a Changed term replaces,
 * and who it's by. Base UI's preview card places it and closes it on `Esc` or a press elsewhere;
 * unlike a popover, it adds nothing focusable around the term.
 */
function HoverCard({
  open,
  anchor,
  container,
  definition,
  shown,
  rendering,
  menu,
  onClose,
  onPointerEnter,
  onPointerLeave,
  onContextMenu,
}: HoverCardProps) {
  const own = shown?.source !== 'store';
  // The overview's own shows its opening paragraph, the repo's whole: it's one paragraph.
  const blocks = shown?.blocks ?? definition?.children ?? [];
  const [first, ...rest] = blocks;
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
            className="move-pop"
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            render={(props) => (
              <MarkdownProvider rendering={rendering}>
                <TermCard
                  {...props}
                  menu={menu}
                  onContextMenu={onContextMenu}
                  term={shown?.name ?? definition?.name ?? ''}
                  marks={shown && { mark: shown.marks.mark, locked: shown.marks.locked }}
                  definition={first?.kind === 'paragraph' ? <Inlines blocks={blocks} /> : undefined}
                  more={own && first?.kind === 'paragraph' && rest.length > 0}
                  before={shown?.before && <Inlines blocks={shown.before} />}
                  byline={shown?.byline}
                />
              </MarkdownProvider>
            )}
          />
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

/** A definition's opening paragraph, as words: the card's links take a click and no focus. */
function Inlines({ blocks }: { blocks: readonly OverviewBlock[] }) {
  const [first] = blocks;
  return first?.kind === 'paragraph' ? <MarkdownInlines<Overview> nodes={first.children} /> : null;
}
