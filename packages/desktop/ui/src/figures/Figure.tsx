// An overview's figure, as the check left it: an SVG drawn from its checked tree, an image drawn on
// a canvas, or, for a figure left out, a note saying why (the Figure guideline's `--broken`). The
// overview's renderer places one for each `:::figure` block, giving it what the check found for
// that block, the bytes of an image, its caption as it renders it, and the parts it links.

import type { FigureState, ImageType } from '@lo/artifact';
import type { SvgElement } from '@lo/markdown';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { imageSize, scroller, showImage, widest, type DrawFailure } from './image.ts';
import { drawSvg, linkParts, sizeHits, type PartLink } from './svg.ts';

export interface FigureProps {
  /** Its file, `figures/` and its name, which a note names when it can't be shown. */
  path: string;
  /** What the overview's check found it to be, for this block. */
  figure: FigureState;
  /** The bytes of an image the check kept, whole, as the check read them. */
  bytes?: Uint8Array<ArrayBuffer> | undefined;
  /** Its number in the overview, from 1. */
  number: number;
  /** Its caption, as the overview's renderer draws it. */
  caption?: ReactNode;
  /**
   * The parts its block links, in the order written, each with where it goes in words. Only those
   * the check kept for this block are linked.
   */
  parts?: readonly PartLink[] | undefined;
  /** Called when a part is clicked, with the part's link. */
  onFollow?: ((part: PartLink, from: Element) => void) | undefined;
  /** What shows under a part while it's hovered or has focus, if anything. */
  preview?: ((part: PartLink) => ReactNode) | undefined;
}

/** An overview's figure. */
export function Figure(props: FigureProps) {
  const { figure, path, number, caption } = props;
  switch (figure.state) {
    case 'kept':
      if (figure.type === 'svg') {
        return <SvgFigure {...props} svg={figure.svg} kept={figure.parts} />;
      }
      return <ImageFigure {...props} type={figure.type} size={figure} />;
    case 'leftOut':
    case 'unread':
      return <Broken path={path} number={number} caption={caption} why={figure.why} />;
    default:
      // From another process: say so, rather than draw what Lo doesn't know.
      figure satisfies never;
      return <Broken path={path} number={number} caption={caption} why="failed" />;
  }
}

/** How many figures have been drawn: each block that shows one gets a scope of its own. */
let scopes = 0;

function nextScope(): string {
  scopes += 1;
  return `lo-fig${scopes}`;
}

/** The space a part's preview keeps from the part, in pixels. */
const PREVIEW_GAP = 6;

function SvgFigure({
  svg: tree,
  kept,
  parts,
  path,
  number,
  caption,
  onFollow,
  preview,
}: FigureProps & { svg: SvgElement; kept: readonly string[] }) {
  const [scope] = useState(nextScope);
  const own = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const shown = useRef<HTMLDivElement>(null);
  const follow = useRef(onFollow);
  useLayoutEffect(() => {
    follow.current = onFollow;
  });
  const [active, setActive] = useState<{ part: PartLink; link: Element }>();

  // Only parts the check kept for this block, drawn again only when they change, not with each
  // new list of the same parts.
  const chosen = (parts ?? []).filter((part) => kept.includes(part.id));
  const key = JSON.stringify(chosen);
  const linked = useMemo(() => chosen, [key]);
  const drawn = useMemo(() => {
    const made = drawSvg(tree, scope);
    return made && { ...made, links: linkParts(made, linked) };
  }, [tree, scope, linked]);

  useLayoutEffect(() => {
    const host = frame.current;
    if (!drawn || !host) return undefined;
    if (drawn.box) host.style.setProperty('--lo-fig-widest', `${widest(drawn.box)}px`);
    host.prepend(drawn.svg);
    sizeHits(drawn.links);
    // Text's boxes change as fonts arrive, and its hit areas with them.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) sizeHits(drawn.links);
    });
    const partOf = (event: Event): { part: PartLink; link: Element } | undefined => {
      const link = event.target instanceof Element ? event.target.closest('.lo-fig-link') : null;
      const part =
        link && drawn.svg.contains(link)
          ? linked[Number(link.getAttribute('data-part'))]
          : undefined;
      return link && part ? { part, link } : undefined;
    };
    const enter = (event: Event): void => {
      const found = partOf(event);
      if (found) setActive(found);
    };
    const leave = (event: Event): void => {
      const found = partOf(event);
      const next =
        event instanceof FocusEvent || event instanceof MouseEvent ? event.relatedTarget : null;
      if (found && !(next instanceof Node && found.link.contains(next))) setActive(undefined);
    };
    const click = (event: Event): void => {
      const found = partOf(event);
      if (found) follow.current?.(found.part, found.link);
    };
    const svg = drawn.svg;
    svg.addEventListener('mouseover', enter);
    svg.addEventListener('focusin', enter);
    svg.addEventListener('mouseout', leave);
    svg.addEventListener('focusout', leave);
    svg.addEventListener('click', click);
    return () => {
      live = false;
      svg.removeEventListener('mouseover', enter);
      svg.removeEventListener('focusin', enter);
      svg.removeEventListener('mouseout', leave);
      svg.removeEventListener('focusout', leave);
      svg.removeEventListener('click', click);
      svg.remove();
      host.style.removeProperty('--lo-fig-widest');
      setActive(undefined);
    };
  }, [drawn, linked]);

  // The preview goes under its part, kept inside the figure's width.
  const content = active && preview?.(active.part);
  useLayoutEffect(() => {
    const box = shown.current;
    const figure = own.current;
    if (!active || !box || !figure) return;
    const part = active.link.getBoundingClientRect();
    const whole = figure.getBoundingClientRect();
    const left = Math.max(0, Math.min(part.left - whole.left, whole.width - box.offsetWidth));
    box.style.left = `${left}px`;
    box.style.top = `${part.bottom - whole.top + PREVIEW_GAP}px`;
  }, [active, content]);

  if (!drawn) return <Broken path={path} number={number} caption={caption} why="content" />;
  // With no size of its own, it would be drawn at whatever size its box has, and cut there.
  if (!drawn.box) return <Broken path={path} number={number} caption={caption} why="header" />;
  return (
    <figure ref={own} className="lo-figure relative">
      <div ref={frame} className="lo-figure__frame" />
      <Caption number={number} caption={caption} />
      {content ? (
        <div
          ref={shown}
          role="tooltip"
          className="lo-figpreview z-popover rounded-md bg-bg-overlay text-fg shadow-pop"
        >
          {content}
        </div>
      ) : null}
    </figure>
  );
}

function ImageFigure({
  type,
  size,
  bytes,
  path,
  number,
  caption,
}: FigureProps & { type: ImageType; size: { width: number; height: number } }) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failure, setFailure] = useState<DrawFailure>();
  const { width, height } = size;
  const laid = useMemo(
    () => (bytes ? imageSize(type, { width, height }, bytes) : { width, height }),
    [type, width, height, bytes],
  );

  useLayoutEffect(() => {
    const host = frame.current;
    if (!host) return undefined;
    host.style.setProperty('--lo-fig-widest', `${widest(laid, laid.width)}px`);
    host.style.setProperty('--lo-fig-aspect', `${laid.width} / ${laid.height}`);
    return () => {
      host.style.removeProperty('--lo-fig-widest');
      host.style.removeProperty('--lo-fig-aspect');
    };
  }, [laid]);

  useEffect(() => {
    const drawing = canvas.current;
    if (!drawing || !bytes || failure) return undefined;
    return showImage({
      canvas: drawing,
      type,
      bytes,
      size: laid,
      root: scroller(drawing),
      failed: setFailure,
    });
  }, [type, bytes, laid, failure]);

  if (failure)
    return <Broken path={path} number={number} caption={caption} why={failure} type={type} />;
  return (
    <figure className="lo-figure">
      <div ref={frame} className="lo-figure__frame">
        <canvas ref={canvas} width={0} height={0} role="img" aria-label={`Figure ${number}`} />
      </div>
      <Caption number={number} caption={caption} />
    </figure>
  );
}

function Caption({ number, caption }: { number: number; caption: ReactNode }) {
  return (
    <figcaption>
      <b>Figure {number}.</b> {caption}
    </figcaption>
  );
}

/** Why a figure isn't drawn: why the check left it out or unread, or why it couldn't be drawn. */
type Why =
  | Extract<FigureState, { state: 'leftOut' }>['why']
  | Extract<FigureState, { state: 'unread' }>['why']
  | DrawFailure;

/** Each type's name, as a sentence gives it. */
const NAMES: Readonly<Record<ImageType, string>> = {
  png: 'a PNG',
  jpeg: 'a JPEG',
  gif: 'a GIF',
  webp: 'a WebP',
};

/** Why, in a sentence that follows the figure's path. */
function reason(why: Why, path: string, type: ImageType | undefined): string {
  switch (why) {
    case 'missing':
      return "isn't in the overview's commit.";
    case 'notFile':
      return "isn't a file.";
    case 'type':
      return "isn't the type its name says.";
    case 'header':
      // An SVG's size is its viewBox; an image's is in its header.
      return path.endsWith('.svg')
        ? "has no viewBox, so Lo can't tell its size."
        : "has a damaged header, so Lo can't tell its size.";
    case 'encoding':
      return "isn't UTF-8, which an SVG figure must be.";
    case 'content':
      return "holds what a figure can't, such as a script, a style or an outside image.";
    case 'tooLarge':
      return 'is larger than a figure may be.';
    case 'failed':
      return "couldn't be read.";
    case 'stopped':
      return 'took too long to read.';
    case 'decode':
      return type ? `didn't decode as ${NAMES[type]}.` : "didn't decode.";
    case 'size':
      return 'decoded at another size than its header gives.';
    default:
      why satisfies never;
      return "couldn't be shown.";
  }
}

function Broken({
  path,
  number,
  caption,
  why,
  type,
}: {
  path: string;
  number: number;
  caption?: ReactNode;
  why: Why;
  type?: ImageType | undefined;
}) {
  return (
    <figure className="lo-figure lo-figure--broken">
      <div className="lo-figure__frame">
        <svg className="lo-i lo-i--sm mt-2 flex-none" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
          <path d="M8 6.25v3M8 11.25v.01" />
        </svg>
        <p className="min-w-0 wrap-anywhere">
          <strong>Figure {number} can't be shown.</strong> {path} {reason(why, path, type)}
        </p>
      </div>
      <Caption number={number} caption={caption} />
    </figure>
  );
}
