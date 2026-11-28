import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { flushSync } from 'react-dom';

import type {
  Excerpt,
  Figure,
  Overview,
  OverviewBlock,
  OverviewTree,
  Walkthrough,
} from '@lo/artifact';
import type { Code } from '@lo/markdown';

import { Collapse } from '../Collapse.tsx';
import { heldRegistry } from '../commands/control.ts';
import { NO_TARGET } from '../commands/targets.ts';
import { HintButton } from '../HintButton.tsx';
import { Icon } from '../Icon.tsx';
import {
  Anchors,
  anchorNames,
  Fold,
  FollowLink,
  MarkdownBlock,
  MarkdownInlines,
  MarkdownNotes,
  MarkdownProvider,
  generationOf,
  reveal,
  scopePrefix,
  type Followed,
  type MarkdownExtension,
  type Rendering,
} from '../markdown/index.ts';
import { blockHints, isStop, type BlockHint } from './blocks.ts';
import { holdPlace } from './hold.ts';
import { Glossary } from './Glossary.tsx';
import { SECTION_BODY_CLASS, SECTION_CLASS } from './moving.ts';
import { SectionHead } from './SectionHead.tsx';
import { sectionAt, sectionsOf, type OverviewSection } from './sections.ts';
import {
  GlossaryContext,
  ReachedContext,
  readGlossary,
  type GlossaryState,
  type OverviewTerms,
  type Reached,
} from './terms.ts';
import { Illustration } from './CodeBlock.tsx';
import { ExcerptHead, FigureCaption, WalkthroughSteps } from './placeholders.tsx';
import { Tabs } from './Tabs.tsx';
import { Term } from './Term.tsx';

/** Where a reader followed a link in an overview: a page, a section, code or a term. */
export type OverviewTarget = Followed<Overview>;

/**
 * How the blocks that show the repository draw, given by whoever has what they show. Until one is
 * given, a block shows what it points at and its own words.
 */
export interface OverviewViews {
  /** A `:::code` block: the lines it names, at the overview's commit. */
  excerpt?: ((node: Excerpt) => ReactNode) | undefined;
  /** A `:::figure` block, as its check kept it. */
  figure?: ((node: Figure) => ReactNode) | undefined;
  /** A `:::walkthrough` block, its steps beside their code. */
  walkthrough?: ((node: Walkthrough) => ReactNode) | undefined;
  /** A plain fenced block, which is never code from the pull request: an illustration unless given. */
  fence?: ((node: Code) => ReactNode) | undefined;
}

/**
 * How an overview's sections fold, kept by whoever shows it: which are collapsed now, the command a
 * heading's chevron runs, and how what goes into a collapsed one expands it first.
 */
export interface OverviewFolds {
  /** The sections collapsed now, by their heading's block number. */
  readonly collapsed: ReadonlySet<number>;
  /**
   * The command a section's chevron runs on it, Collapse section and then Expand section, which a
   * click on a collapsed heading's words runs too.
   */
  readonly fold: (heading: number) => BlockHint;
  /**
   * Expands the sections whose headings are `headings` at once, as anything that goes into one
   * does before it gets there: a link, the outline, a term's entry. It counts each in `opened`. It's
   * asked inside `flushSync`, so what it changes is drawn in the same frame.
   */
  readonly expand: (headings: readonly number[]) => void;
  /**
   * The sections opened at once, by their heading's block number, counted: each such opening draws
   * the section's box anew, open from the start, so nothing moves.
   */
  readonly opened: ReadonlyMap<number, number>;
}

export interface OverviewDocumentProps {
  tree: OverviewTree;
  /** What the outline is headed: "Overview", or "Stack overview" for a stack's. */
  label?: string | undefined;
  /**
   * Blocks of `tree` whoever shows it draws, in place of what they hold, by the block: each is a
   * stop for the block keys, drawn with the spacing prose has, as a stack overview's list of its
   * layers is.
   */
  own?: ReadonlyMap<OverviewBlock, ReactNode> | undefined;
  /** Who wrote it and for which commit, at the top of the article. */
  byline?: ReactNode;
  /** What the reader should know first, such as that it was written for an older push. */
  banner?: ReactNode;
  /** The focused block, by its number: it shows its ring and its keys. */
  focused?: number | undefined;
  /** Whether the outline of sections shows beside the article. Narrow sheets hide it anyway. */
  outline?: boolean | undefined;
  /** What sits under the outline's sections: the buttons that move between blocks. */
  outlineFoot?: ReactNode;
  views?: OverviewViews | undefined;
  /**
   * A link was followed, from `from`. A section or a term has already been brought into view,
   * and a web target is always an `https://` page, for main to open.
   */
  onFollow?: ((target: OverviewTarget, from: Element) => void) | undefined;
  /**
   * What each focused block's chip offers, given the block and its number: by default, what its
   * kind can do, on whatever has focus. It's asked again whenever it's a new function, so one that
   * changes as what the chip says does draws the chip again.
   */
  hints?: ((block: OverviewBlock, number: number) => readonly BlockHint[]) | undefined;
  /** Where hover cards go: an element inside `.lo-app`. By default, the `.lo-app` it's in. */
  container?: HTMLElement | null | undefined;
  /**
   * How its sections fold. With it, each heading of its own but the tl;dr's folds its section: a
   * chevron, its words and a `⋯` (`SectionHead`), and what's under it in a box that opens and
   * closes. Without it, nothing folds.
   */
  folds?: OverviewFolds | undefined;
  /**
   * The repo's definitions, as the overview shows its terms with them: which definition shows for
   * each, its tags and who it's by, and why they can't be used. Without them, each term shows the
   * overview's own definition, untagged.
   */
  terms?: OverviewTerms | undefined;
  /** The scrolling element. */
  ref?: Ref<HTMLDivElement> | undefined;
  /**
   * Whether its blocks are still drawing what they show before it's first seen: the outline and
   * the article are laid out, so the blocks can tell where they are, but not shown.
   */
  drawing?: boolean | undefined;
  /**
   * Whether it's been seen: on screen since its blocks drew. Its place on the page is held from the
   * first frame it's seen in, so a box that moves before then, as a banner over it goes, leaves no
   * room above it. By default, once it's drawn.
   */
  seen?: boolean | undefined;
}

/** How far under the top of the article a section's heading may be, and still be the current one. */
const CURRENT_WITHIN_PX = 48;

/**
 * An overview, read as a document: the outline of its sections in the writer's order, and the
 * article at reading measure, with each block that holds something to act on able to take the
 * block keys' focus. Every id in it is the document's own.
 */
export function OverviewDocument({
  tree,
  label = 'Overview',
  own,
  byline,
  banner,
  focused,
  outline = true,
  outlineFoot,
  views,
  onFollow,
  hints = blockHints,
  container,
  folds,
  terms: shownTerms,
  ref,
  drawing = false,
  seen = !drawing,
}: OverviewDocumentProps) {
  const prefix = scopePrefix(useId());
  const anchors = useMemo(() => new Anchors(prefix, tree.blocks), [prefix, tree.blocks]);
  const glossary = useMemo(() => readGlossary(tree.blocks, anchors), [tree.blocks, anchors]);
  const sections = sectionsOf(tree.blocks);
  const places = useMemo(() => placesOf(tree.blocks), [tree.blocks]);
  const lead = useMemo(() => leadOf(tree.blocks), [tree.blocks]);
  const [current, setCurrent] = useState<number | undefined>(undefined);
  // What the focused block's chip offers. Only that block is drawn again as it changes.
  const offered = useMemo(() => {
    const block = focused === undefined ? undefined : tree.blocks[focused];
    return block === undefined || focused === undefined ? NO_HINTS : hints(block, focused);
  }, [focused, hints, tree.blocks]);
  const [target, setTarget] = useState<string | undefined>(undefined);
  const root = useRef<HTMLDivElement | null>(null);
  const cards = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    cards.current = container ?? root.current?.closest<HTMLElement>('.lo-app') ?? null;
  }, [container]);

  const scroller = useCallback(
    (element: HTMLDivElement | null) => {
      root.current = element;
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  // What's on screen stays where it is on the page as the box moves without the reader, as when a
  // banner over it comes or goes, from the first frame it's seen in. A banner that goes before
  // then, as its blocks draw unseen or it waits behind another view, moves nothing anyone saw, so
  // it leaves no room above it.
  const held = seen && !drawing;
  useLayoutEffect(() => {
    const element = root.current;
    if (!held || !element || typeof ResizeObserver === 'undefined') return undefined;
    return holdPlace(element);
  }, [held]);

  // The latest handler, read when a link is followed, so a new one doesn't draw the article again.
  const handler = useRef(onFollow);
  useLayoutEffect(() => {
    handler.current = onFollow;
  }, [onFollow]);

  // The folds as they are now, read as something goes into a section, so a new set of them doesn't
  // make a new way to follow a link.
  const foldsNow = useRef(folds);
  useLayoutEffect(() => {
    foldsNow.current = folds;
  }, [folds]);
  /**
   * Expands the collapsed section block `block` is in, or heads, at once, before something goes
   * there: drawn in this frame, so what's in it is on the page to go to.
   */
  const goInto = useCallback(
    (block: number | undefined) => {
      const now = foldsNow.current;
      const section = block === undefined ? undefined : sectionAt(sections, block);
      if (!now || !section?.folds || !now.collapsed.has(section.heading)) return;
      flushSync(() => now.expand([section.heading]));
    },
    [sections],
  );

  const follow = useCallback(
    (to: OverviewTarget, from: Element) => {
      if (to.kind === 'anchor') {
        goInto(places.anchors.get(to.name));
        reveal(root.current, anchors.id(to.name));
        const section = sections.find((each) => each.anchor === to.name);
        if (section) setCurrent(section.heading);
      } else if (to.kind === 'term') {
        goInto(places.terms.get(to.key));
        setTarget(to.key);
        reveal(root.current, glossary.termId(to.key));
      }
      handler.current?.(to, from);
    },
    [anchors, glossary, sections, places, goInto],
  );

  const extension = useMemo(() => overviewExtension(views), [views]);
  const rendering = useMemo<Rendering<Overview>>(
    () => ({ anchors, follow, extension, interactive: true }),
    [anchors, follow, extension],
  );
  const terms = useMemo<GlossaryState>(
    () => ({ glossary, container: cards, terms: shownTerms }),
    [glossary, shownTerms],
  );
  const reached = useMemo<Reached>(() => ({ target, leave: () => setTarget(undefined) }), [target]);
  const generation = generationOf(tree);

  // The current section is the last whose heading has reached the top of the article.
  useEffect(() => {
    const element = root.current;
    if (!element || sections.length === 0) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = element.getBoundingClientRect().top;
      let at: number | undefined;
      for (const section of sections) {
        const id = anchors.id(section.anchor);
        const heading = id === undefined ? null : element.ownerDocument.getElementById(id);
        if (!heading || heading.getBoundingClientRect().top - top > CURRENT_WITHIN_PX) break;
        at = section.heading;
      }
      setCurrent(at);
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(update);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [anchors, sections]);

  const shown = current ?? sections[0]?.heading;
  const drawBlock = (index: number) => {
    const block = tree.blocks[index];
    return block === undefined ? null : (
      <ArticleBlock
        // A new tree's blocks start fresh: no fold or tab keeps the state of the one before.
        key={`${generation}:${index}`}
        block={block}
        number={index}
        lead={index === lead}
        focused={focused === index}
        hints={focused === index ? offered : NO_HINTS}
        own={own?.get(block)}
      />
    );
  };
  return (
    <MarkdownProvider rendering={rendering}>
      <GlossaryContext value={terms}>
        <ReachedContext value={reached}>
          <div
            ref={scroller}
            className={[
              'lo-ov',
              outline ? undefined : 'grid-cols-1',
              drawing ? 'is-drawing' : undefined,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {outline && (
              <nav className="lo-ov__toc" aria-label="Sections">
                <div className="lo-toc__label">{label}</div>
                {sections.map((section) => {
                  const collapsed = section.folds && folds?.collapsed.has(section.heading);
                  return (
                    <button
                      key={section.heading}
                      type="button"
                      className="lo-toc__item text-start"
                      aria-current={section.heading === shown}
                      data-collapsed={collapsed ? '' : undefined}
                      onClick={() => {
                        goInto(section.heading);
                        reveal(root.current, anchors.id(section.anchor));
                        setCurrent(section.heading);
                      }}
                    >
                      {collapsed && (
                        // In its ball's place, the heading's chevron, in the ball's room, so the
                        // row's words stay where the others' are.
                        <span className="lo-toc__fold flex w-6 flex-none justify-center">
                          <Icon name="chevron-right" size={12} />
                        </span>
                      )}
                      {section.name}
                    </button>
                  );
                })}
                {outlineFoot !== undefined && <div className="lo-toc__foot">{outlineFoot}</div>}
              </nav>
            )}
            <article className="lo-ov__article lo-prose">
              {byline}
              {banner}
              {folds === undefined
                ? tree.blocks.map((_block, index) => drawBlock(index))
                : sectioned(tree.blocks, sections).map((part) => {
                    if (part.kind === 'block') return drawBlock(part.block);
                    const { section } = part;
                    const { heading } = section;
                    const node = tree.blocks[heading];
                    if (node?.kind !== 'heading') return null;
                    const open = !section.folds || !folds.collapsed.has(heading);
                    const body = anchors.own(`section${heading}`);
                    return (
                      <Fragment key={`${generation}:${heading}`}>
                        <SectionHeading
                          node={node}
                          section={section}
                          id={anchors.id(section.anchor)}
                          open={open}
                          fold={section.folds ? folds.fold : undefined}
                          controls={body}
                          focused={focused === heading}
                          hints={focused === heading ? offered : NO_HINTS}
                        />
                        {section.folds ? (
                          <Collapse
                            // Opened at once, as something went into it: drawn open from the start.
                            key={folds.opened.get(heading) ?? 0}
                            open={open}
                            className={SECTION_CLASS}
                          >
                            <div id={body} className={`lo-prose ${SECTION_BODY_CLASS}`}>
                              {range(section.from, section.to).map(drawBlock)}
                            </div>
                          </Collapse>
                        ) : (
                          range(section.from, section.to).map(drawBlock)
                        )}
                      </Fragment>
                    );
                  })}
              <MarkdownNotes notes={tree.notes} />
            </article>
          </div>
        </ReachedContext>
      </GlossaryContext>
    </MarkdownProvider>
  );
}

interface ArticleBlockProps {
  block: OverviewBlock;
  number: number;
  /** Whether it's the tl;dr's first paragraph, set larger. */
  lead: boolean;
  focused: boolean;
  /** What its chip offers, while it's focused. */
  hints: readonly BlockHint[];
  /** What's drawn in its place, by whoever shows the overview, if they draw it. */
  own?: ReactNode;
}

/**
 * One of the article's blocks. Those the block keys stop at sit in `.lo-block`, with their number
 * and, focused, a ring and their keys: a frame of their own for code, figures, walkthroughs and
 * tabs; for a fold, the fold itself; and around prose, `.lo-block--prose`, which keeps the spacing
 * prose has. Each is drawn again only when what it's given changes, so moving between sections,
 * focus or a term's entry leaves the rest of the article as it is.
 */
const ArticleBlock = memo(function ArticleBlock({
  block,
  number,
  lead,
  focused,
  hints,
  own,
}: ArticleBlockProps) {
  if (own !== undefined) {
    return (
      <div
        className={focused ? 'lo-block lo-block--prose is-focused' : 'lo-block lo-block--prose'}
        data-lo-block={number}
        tabIndex={-1}
      >
        {own}
        {focused ? <Hints hints={hints} fold={false} /> : null}
      </div>
    );
  }
  const drawn =
    lead && block.kind === 'paragraph' ? (
      <p className="lo-lead">
        <MarkdownInlines<Overview> nodes={block.children} />
      </p>
    ) : (
      <MarkdownBlock<Overview> node={block} />
    );
  if (!isStop(block)) return drawn;
  const chip = focused ? <Hints hints={hints} fold={block.kind === 'details'} /> : null;
  if (block.kind === 'details') {
    return (
      <Fold
        node={block}
        kind="More detail"
        className={focused ? 'lo-block lo-block--fold is-focused' : 'lo-block lo-block--fold'}
        number={number}
        summaryEnd={chip}
      />
    );
  }
  const frame = FRAMED.has(block.kind) ? 'lo-block' : 'lo-block lo-block--prose';
  return (
    <div
      className={focused ? [frame, 'is-focused'].join(' ') : frame}
      data-lo-block={number}
      tabIndex={-1}
    >
      {drawn}
      {chip}
    </div>
  );
});

/** An overview's second-level heading. */
type HeadingBlock = Extract<OverviewBlock, { kind: 'heading' }>;

interface SectionHeadingProps {
  node: HeadingBlock;
  section: OverviewSection;
  /** Its anchor's id in the document. */
  id: string | undefined;
  open: boolean;
  /** The command its chevron runs on a section, for one that folds. */
  fold: ((heading: number) => BlockHint) | undefined;
  /** What's under it, by its id. */
  controls: string;
  focused: boolean;
  /** What its chip offers, while it's focused. */
  hints: readonly BlockHint[];
}

/**
 * A section's heading: its words, and for a section that folds, its chevron and `⋯`. Collapsed,
 * it's a block the block keys stop at, with its chip while it's focused. Drawn again only when
 * what it's given changes.
 */
const SectionHeading = memo(function SectionHeading({
  node,
  section,
  id,
  open,
  fold,
  controls,
  focused,
  hints,
}: SectionHeadingProps) {
  return (
    <SectionHead
      name={section.name}
      id={id}
      tabIndex={-1}
      open={open}
      fold={fold?.(section.heading)}
      menu={fold !== undefined}
      controls={controls}
      number={section.heading}
      focused={focused}
      chip={focused ? <Hints hints={hints} fold={false} /> : null}
    >
      <MarkdownInlines<Overview> nodes={node.children} />
    </SectionHead>
  );
});

/** The blocks drawn in a frame of their own, which the block's ring goes around. */
const FRAMED: ReadonlySet<OverviewBlock['kind']> = new Set([
  'excerpt',
  'figure',
  'walkthrough',
  'tabs',
]);

/** A chip that offers nothing, as every block but the focused one has. */
const NO_HINTS: readonly BlockHint[] = [];

/**
 * A focused block's chip: a button for each thing its keys do there, with the key, named by what
 * it does on the block, as its handler's `named` says: "Open link" for `⏎` on prose that links to
 * a page, "Next tab" for `→` on tabs. A press leaves focus on the block, and never reaches the
 * block itself, so a fold's title doesn't take it as a click of its own.
 */
function Hints({ hints, fold }: { hints: readonly BlockHint[]; fold: boolean }) {
  if (hints.length === 0) return null;
  return (
    <span className="lo-block__hints" onClick={(event) => event.stopPropagation()}>
      {hints.map((hint) => (
        <HintButton key={hint.command} command={hint.command} target={hint.target}>
          {fold ? <FoldWords /> : heldRegistry()?.named(hint.command, hint.target ?? NO_TARGET)}
        </HintButton>
      ))}
    </span>
  );
}

/** What its command does to the fold it's in: "Expand" while it's closed, "Collapse" while open. */
function FoldWords() {
  const own = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const fold = own.current?.closest('details');
    if (!fold) return undefined;
    const read = () => setOpen(fold.open);
    read();
    fold.addEventListener('toggle', read);
    return () => fold.removeEventListener('toggle', read);
  }, []);
  return <span ref={own}>{open ? 'Collapse' : 'Expand'}</span>;
}

/** How the overview's own blocks and links draw, in the document's markdown. */
function overviewExtension(views: OverviewViews | undefined): MarkdownExtension<Overview> {
  return {
    block: (node) => {
      switch (node.kind) {
        case 'excerpt':
          return views?.excerpt ? views.excerpt(node) : <ExcerptHead node={node} />;
        case 'figure':
          return views?.figure ? views.figure(node) : <FigureCaption node={node} />;
        case 'walkthrough':
          return views?.walkthrough ? views.walkthrough(node) : <WalkthroughSteps node={node} />;
        case 'tabs':
          return <Tabs node={node} />;
        case 'glossary':
          return <Glossary node={node} />;
        default:
          node satisfies never;
          throw new Error(`A kind of overview block Lo doesn’t know: ${JSON.stringify(node)}.`);
      }
    },
    link: (target, children) => {
      switch (target.kind) {
        case 'code':
          return <FollowLink<Overview> target={target}>{children}</FollowLink>;
        case 'term':
          return <Term term={target}>{children}</Term>;
        default:
          target satisfies never;
          throw new Error(`A kind of overview link Lo doesn’t know: ${JSON.stringify(target)}.`);
      }
    },
    details: (node) => <Fold node={node} kind="More detail" />,
    // A plain fence is never code from the pull request: an illustration, unless given otherwise.
    code: views?.fence ?? ((node) => <Illustration node={node} />),
  };
}

/** A part of the article as it's drawn with sections that fold: a block of its own, or a section. */
type Part = { kind: 'block'; block: number } | { kind: 'section'; section: OverviewSection };

/**
 * The article's parts, in order: the blocks before the first section, then each section, its
 * heading with the blocks under it, then what's after the last, its footnotes.
 */
function sectioned(blocks: readonly OverviewBlock[], sections: readonly OverviewSection[]): Part[] {
  const first = sections[0]?.heading ?? blocks.length;
  const last = sections.at(-1)?.to ?? blocks.length;
  return [
    ...range(0, first).map(blockPart),
    ...sections.map((section): Part => ({ kind: 'section', section })),
    ...range(last, blocks.length).map(blockPart),
  ];
}

/** Block `block` as a part of the article of its own. */
function blockPart(block: number): Part {
  return { kind: 'block', block };
}

/** The numbers from `from` up to, not including, `to`. */
function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, at) => from + at);
}

/**
 * Where the article's own places are, by the block they're in: each anchor, a heading's or a
 * note's, and each term the glossary defines.
 */
function placesOf(blocks: readonly OverviewBlock[]): {
  anchors: ReadonlyMap<string, number>;
  terms: ReadonlyMap<string, number>;
} {
  const anchors = new Map<string, number>();
  const terms = new Map<string, number>();
  for (const [at, block] of blocks.entries()) {
    for (const name of anchorNames([block])) if (!anchors.has(name)) anchors.set(name, at);
    if (block.kind !== 'glossary') continue;
    for (const term of block.terms) if (!terms.has(term.key)) terms.set(term.key, at);
  }
  return { anchors, terms };
}

/** The block number of the tl;dr's first paragraph, which leads: the overview opens with it. */
function leadOf(blocks: readonly OverviewBlock[]): number | undefined {
  const first = blocks[0];
  if (first?.kind !== 'heading' || first.level !== 2 || first.anchor !== 'tldr') return undefined;
  return blocks[1]?.kind === 'paragraph' ? 1 : undefined;
}
