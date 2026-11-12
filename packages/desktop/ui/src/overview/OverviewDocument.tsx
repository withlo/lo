import {
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

import type {
  Excerpt,
  Figure,
  Overview,
  OverviewBlock,
  OverviewTree,
  Walkthrough,
} from '@lo/artifact';
import { plainText, type Code } from '@lo/markdown';

import { Key } from '../Key.tsx';
import {
  Anchors,
  Fold,
  FollowLink,
  MarkdownBlock,
  MarkdownInlines,
  MarkdownNotes,
  MarkdownProvider,
  reveal,
  scopePrefix,
  type Followed,
  type MarkdownExtension,
  type Rendering,
} from '../markdown/index.ts';
import { blockHints, isStop, type BlockHint } from './blocks.ts';
import { Glossary } from './Glossary.tsx';
import { GlossaryContext, readGlossary, type GlossaryState } from './terms.ts';
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
  /** A plain fenced block, which is never code from the pull request. */
  fence?: ((node: Code) => ReactNode) | undefined;
}

export interface OverviewDocumentProps {
  tree: OverviewTree;
  /** Who wrote it and for which commit, at the top of the article. */
  byline?: ReactNode;
  /** What the reader should know first, such as that it was written for an older push. */
  banner?: ReactNode;
  /** The focused block, by its number: it shows its ring and its keys. */
  focused?: number | undefined;
  /** Whether the outline of sections shows beside the article. Narrow sheets hide it anyway. */
  outline?: boolean | undefined;
  /** What the outline says under its sections, such as the block keys. */
  outlineFoot?: ReactNode;
  views?: OverviewViews | undefined;
  /**
   * A link was followed, from `from`. A section or a term has already been brought into view,
   * and a web target is always an `https://` page, for main to open.
   */
  onFollow?: ((target: OverviewTarget, from: HTMLElement) => void) | undefined;
  /** Says what each focused block can do: by default, what its kind can. */
  hints?: ((block: OverviewBlock) => readonly BlockHint[]) | undefined;
  /** Where hover cards go: an element inside `.lo-app`. By default, the `.lo-app` it's in. */
  container?: HTMLElement | null | undefined;
  /** The scrolling element. */
  ref?: Ref<HTMLDivElement> | undefined;
}

/** A section of the outline: a heading of the article's own, by its block's number. */
interface Section {
  block: number;
  anchor: string;
  title: string;
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
  byline,
  banner,
  focused,
  outline = true,
  outlineFoot,
  views,
  onFollow,
  hints = blockHints,
  container,
  ref,
}: OverviewDocumentProps) {
  const prefix = scopePrefix(useId());
  const anchors = useMemo(() => new Anchors(prefix, tree.blocks), [prefix, tree.blocks]);
  const glossary = useMemo(() => readGlossary(tree.blocks, anchors), [tree.blocks, anchors]);
  const sections = useMemo(() => outlineOf(tree.blocks), [tree.blocks]);
  const lead = useMemo(() => leadOf(tree.blocks), [tree.blocks]);
  const [current, setCurrent] = useState<number | undefined>(undefined);
  const [target, setTarget] = useState<string | undefined>(undefined);
  const root = useRef<HTMLDivElement | null>(null);
  const [app, setApp] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setApp(root.current?.closest<HTMLElement>('.lo-app') ?? null);
  }, []);

  const scroller = useCallback(
    (element: HTMLDivElement | null) => {
      root.current = element;
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  const follow = useCallback(
    (to: OverviewTarget, from: HTMLElement) => {
      if (to.kind === 'anchor') {
        reveal(root.current, anchors.id(to.name));
        const section = sections.find((each) => each.anchor === to.name);
        if (section) setCurrent(section.block);
      } else if (to.kind === 'term') {
        setTarget(to.key);
        reveal(root.current, glossary.termId(to.key));
      }
      onFollow?.(to, from);
    },
    [anchors, glossary, sections, onFollow],
  );

  const extension = useMemo(() => overviewExtension(views), [views]);
  const rendering = useMemo<Rendering<Overview>>(
    () => ({ anchors, follow, extension, interactive: true }),
    [anchors, follow, extension],
  );
  const terms = useMemo<GlossaryState>(
    () => ({ glossary, target, leave: () => setTarget(undefined), container: container ?? app }),
    [glossary, target, container, app],
  );

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
        at = section.block;
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

  const shown = current ?? sections[0]?.block;
  return (
    <MarkdownProvider rendering={rendering}>
      <GlossaryContext value={terms}>
        <div ref={scroller} className={outline ? 'lo-ov' : 'lo-ov grid-cols-1'}>
          {outline && (
            <nav className="lo-ov__toc" aria-label="Sections">
              <div className="lo-toc__label">Overview</div>
              {sections.map((section) => (
                <button
                  key={section.block}
                  type="button"
                  className="lo-toc__item text-start"
                  aria-current={section.block === shown}
                  onClick={() => {
                    reveal(root.current, anchors.id(section.anchor));
                    setCurrent(section.block);
                  }}
                >
                  {section.title}
                </button>
              ))}
              {outlineFoot !== undefined && <div className="lo-toc__foot">{outlineFoot}</div>}
            </nav>
          )}
          <article className="lo-ov__article lo-prose">
            {byline}
            {banner}
            {tree.blocks.map((block, index) => (
              <ArticleBlock
                key={index}
                block={block}
                number={index}
                lead={index === lead}
                focused={focused === index}
                hints={hints}
              />
            ))}
            <MarkdownNotes notes={tree.notes} />
          </article>
        </div>
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
  hints: (block: OverviewBlock) => readonly BlockHint[];
}

/**
 * One of the article's blocks. Those the block keys stop at carry their number and, focused, a
 * ring and their keys: in a frame of their own for code, figures, walkthroughs and tabs, and
 * around the text for prose and folds, which keep the spacing prose has.
 */
function ArticleBlock({ block, number, lead, focused, hints }: ArticleBlockProps) {
  const drawn =
    lead && block.kind === 'paragraph' ? (
      <p className="lo-lead">
        <MarkdownInlines<Overview> nodes={block.children} />
      </p>
    ) : (
      <MarkdownBlock<Overview> node={block} />
    );
  if (!isStop(block)) return drawn;
  const chip = focused ? <Hints hints={hints(block)} /> : null;
  if (block.kind === 'details') {
    return (
      <Fold
        node={block}
        kind="More detail"
        className={focused ? 'lo-ov-stop is-focused' : 'lo-ov-stop'}
        number={number}
        summaryEnd={chip}
      />
    );
  }
  const frame = FRAMED.has(block.kind) ? 'lo-block' : 'lo-ov-stop';
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
}

/** The blocks drawn in a frame of their own, which the block's ring goes around. */
const FRAMED: ReadonlySet<OverviewBlock['kind']> = new Set([
  'excerpt',
  'figure',
  'walkthrough',
  'tabs',
]);

/** A focused block's chip: what its keys do. */
function Hints({ hints }: { hints: readonly BlockHint[] }) {
  if (hints.length === 0) return null;
  return (
    <span className="lo-block__hints" aria-hidden="true">
      {hints.map((hint) => (
        <span key={hint.label} className="inline-flex items-center gap-4">
          {hint.keys.map((keys) => (
            <Key key={keys.join(' ')} keys={keys} quiet decorative />
          ))}
          {hint.label}
        </span>
      ))}
    </span>
  );
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
          throw new Error(`A kind of overview block Lo doesn't know: ${JSON.stringify(node)}.`);
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
          throw new Error(`A kind of overview link Lo doesn't know: ${JSON.stringify(target)}.`);
      }
    },
    details: (node) => <Fold node={node} kind="More detail" />,
    code: views?.fence,
  };
}

/** The article's sections, for the outline: its own second-level headings, in order. */
function outlineOf(blocks: readonly OverviewBlock[]): Section[] {
  const sections: Section[] = [];
  for (const [block, node] of blocks.entries()) {
    if (node.kind !== 'heading' || node.level !== 2) continue;
    const title = plainText({ blocks: [node], notes: [], diagnostics: [] }, 200);
    sections.push({ block, anchor: node.anchor, title });
  }
  return sections;
}

/** The block number of the tl;dr's first paragraph, which leads: the overview opens with it. */
function leadOf(blocks: readonly OverviewBlock[]): number | undefined {
  const first = blocks[0];
  if (first?.kind !== 'heading' || first.level !== 2 || first.anchor !== 'tldr') return undefined;
  return blocks[1]?.kind === 'paragraph' ? 1 : undefined;
}
