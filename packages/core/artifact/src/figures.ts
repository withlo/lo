/**
 * The figures an overview shows, checked in its own commit: each is there, as a file, of the type
 * its name says, within its limits. An SVG goes through `sanitizeSvg`, and is kept only when nothing
 * in it had to be removed or refused, since a figure missing some of what it draws can mislead. Its
 * parts must name elements Lo can link, and a color that isn't one of Lo's is a warning. An image's
 * type and size come from its header alone: nothing here decodes it.
 *
 * Each figure is read once, however many blocks show it, in the order the overview first shows it:
 * its first {@link FIGURE_HEAD} bytes, then the rest only for an SVG, or for an image whose header
 * goes on past them. SVGs are read up to {@link LIMITS.svgs} together, so which figures are kept
 * never depends on how fast the reader is. A reader that fails, or is too slow, leaves its figure
 * unread, and never keeps the check waiting.
 */

import {
  FIGURE_COLORS,
  MAX_DIAGNOSTICS,
  sanitizeSvg,
  SVG_ELEMENTS,
  SVG_LIMITS,
  type SvgElement,
  type SvgReason,
  type SvgRemoval,
} from '@lo/markdown';

import { article } from './commit.ts';
import { quote, type Findings } from './findings.ts';
import { imageHeader, imageType, type ImageType } from './images.ts';
import { FIGURE_HEAD, LIMITS } from './limits.ts';
import { answered, type EntryKind, type FileAnswer, type Unread } from './readers.ts';
import type { FigureReference } from './reading.ts';
import { firstInvalid, lineAt } from './source.ts';

/** What a figure is drawn as: an SVG, or an image of one of the types Lo reads. */
export type FigureType = 'svg' | ImageType;

/**
 * What a figure an overview shows is, in its commit.
 *
 * - `kept`: Lo shows it. An SVG is shown as `svg`, the tree `sanitizeSvg` made, with `parts`, the
 *   ids of the block's parts that name elements Lo can link. An image is shown from its file, as an
 *   image of its type, decoded no larger than its header says.
 * - `leftOut`: Lo shows a note in its place, and why: nothing is at its path, the path is a link or
 *   folder, its bytes aren't the type its name says, its header is damaged, an SVG isn't UTF-8,
 *   `sanitizeSvg` removed some of what it holds, or it's past a limit.
 * - `unread`: the reader failed, or was stopped, before it answered.
 */
export type FigureState =
  | { state: 'kept'; type: 'svg'; svg: SvgElement; parts: string[] }
  | { state: 'kept'; type: ImageType; width: number; height: number }
  | {
      state: 'leftOut';
      why: 'missing' | 'notFile' | 'type' | 'header' | 'encoding' | 'content' | 'tooLarge';
    }
  | { state: 'unread'; why: 'failed' | 'stopped' };

/** A figure the overview shows, and what's there. */
export interface CheckedFigure {
  reference: FigureReference;
  figure: FigureState;
}

/** Reads a file of the overview's commit, as `OverviewFiles.read` does. */
export type FigureReader = (path: string, cap: number, signal: AbortSignal) => Promise<unknown>;

/** What reading a figure found, kept for the blocks that show it. */
type Found =
  | {
      kind: 'svg';
      svg: SvgElement;
      /** Each id in it, and what it is, if it isn't an element Lo can link. */
      ids: ReadonlyMap<string, string | undefined>;
      /** Its colors that aren't Lo's: the first few, and one more if there are more. */
      colors: readonly string[];
      /** What `sanitizeSvg` removed: with any, the figure is left out. */
      removed: readonly SvgRemoval[];
    }
  | { kind: 'image'; type: ImageType; width: number; height: number }
  | { kind: 'missing' }
  | { kind: 'notFile'; is: Exclude<EntryKind, 'file'> }
  | { kind: 'type'; is: ImageType | undefined }
  | { kind: 'header'; why: string }
  | { kind: 'encoding'; line: number }
  | { kind: 'tooLarge'; why: string }
  | Unread;

/**
 * Checks each figure `references` names, up to the limit on figures, in the overview's commit:
 * `kinds` says what each path is, and `read` reads it. Adds what's wrong to `findings`, saying of a
 * path that isn't there what `otherCase` adds. Once `signal` aborts, what isn't read yet is left
 * unread.
 */
export async function checkFigures(
  references: readonly FigureReference[],
  kinds: ReadonlyMap<string, EntryKind>,
  read: FigureReader,
  findings: Findings,
  signal: AbortSignal,
  otherCase: (path: string) => string,
): Promise<CheckedFigure[]> {
  const found = new Map<string, Found>();
  let room = LIMITS.svgs;
  for (const { path } of references) {
    if (found.has(path)) continue;
    const kind = kinds.get(path);
    if (kind === undefined) {
      found.set(path, { kind: 'missing' });
    } else if (kind !== 'file') {
      found.set(path, { kind: 'notFile', is: kind });
    } else {
      const figure = await readFigure(
        (cap) => answered(() => read(path, cap, signal), cap, signal),
        path,
        room,
      );
      room -= figure.svg;
      found.set(path, figure.found);
    }
  }

  return references.map((reference) => {
    const file = found.get(reference.path) ?? { kind: 'unread', why: 'stopped' };
    report(findings, reference, file, otherCase);
    return { reference, figure: stateOf(reference, file) };
  });
}

/** The type a figure's name says it is, by its ending. */
function namedType(path: string): FigureType {
  const ending = path.slice(path.lastIndexOf('.') + 1);
  switch (ending) {
    case 'png':
    case 'gif':
    case 'webp':
    case 'svg':
      return ending;
    default:
      // `.jpg` or `.jpeg`: the parse lets through no other ending.
      return 'jpeg';
  }
}

/**
 * Reads the figure at `path`, with `room` bytes of SVG left to read, and how many bytes of SVG
 * that takes. Its first bytes come first, so a file of the wrong type, or too large, is read no
 * further.
 */
async function readFigure(
  read: (cap: number) => Promise<FileAnswer | Unread>,
  path: string,
  room: number,
): Promise<{ found: Found; svg: number }> {
  const named = namedType(path);
  const head = await read(FIGURE_HEAD);
  // The listing says a file is there, so any other answer is the reader's mistake.
  if (head.kind !== 'file') return { found: unread(head), svg: 0 };
  const is = imageType(head.bytes);
  const whole = async (): Promise<Extract<FileAnswer, { kind: 'file' }> | Unread> => {
    if (head.bytes.length === head.size) return head;
    const all = await read(head.size);
    // The same file in the same commit, answered differently.
    return all.kind === 'file' && all.size === head.size ? all : unread(all);
  };

  if (named === 'svg') {
    if (is !== undefined) return { found: { kind: 'type', is }, svg: 0 };
    if (head.size > LIMITS.svg) {
      return {
        found: {
          kind: 'tooLarge',
          why: `is larger than ${kibibytes(LIMITS.svg)}, the most an SVG figure may be`,
        },
        svg: 0,
      };
    }
    if (head.size > room) {
      return {
        found: {
          kind: 'tooLarge',
          why: `is past what's left of the ${mebibytes(LIMITS.svgs)} of SVG Lo reads for an overview's figures, which the SVGs shown before it take up`,
        },
        svg: 0,
      };
    }
    const all = await whole();
    if (all.kind !== 'file') return { found: all, svg: 0 };
    return { found: svgFigure(all.bytes), svg: all.size };
  }

  if (is !== named) return { found: { kind: 'type', is }, svg: 0 };
  if (head.size > LIMITS.image) {
    return {
      found: {
        kind: 'tooLarge',
        why: `is larger than ${mebibytes(LIMITS.image)}, the most an image figure may be`,
      },
      svg: 0,
    };
  }
  let header = imageHeader(named, head.bytes, head.bytes.length === head.size);
  if (header.kind === 'more') {
    const all = await whole();
    if (all.kind !== 'file') return { found: all, svg: 0 };
    header = imageHeader(named, all.bytes, true);
  }
  switch (header.kind) {
    case 'more':
      // Never, from the whole file.
      return { found: { kind: 'header', why: 'ends before its header does' }, svg: 0 };
    case 'damaged':
      return { found: { kind: 'header', why: header.why }, svg: 0 };
    case 'size': {
      const { width, height } = header;
      if (width > LIMITS.side || height > LIMITS.side || width * height > LIMITS.pixels) {
        return {
          found: {
            kind: 'tooLarge',
            why: `is ${count(width)} by ${count(height)} pixels, and an image figure is at most ${count(LIMITS.side)} a side and ${LIMITS.pixels / 1_000_000} megapixels`,
          },
          svg: 0,
        };
      }
      return { found: { kind: 'image', type: named, width, height }, svg: 0 };
    }
    default:
      header satisfies never;
      throw new Error(`Unknown header ${JSON.stringify(header)}`);
  }
}

/** A reader's answer that isn't a file, where one is: unread, as it failed. */
function unread(answer: FileAnswer | Unread): Unread {
  return answer.kind === 'unread' ? answer : { kind: 'unread', why: 'failed' };
}

/** An SVG figure's bytes, read: its text, as `sanitizeSvg` keeps it. */
function svgFigure(bytes: Uint8Array): Found {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { kind: 'encoding', line: lineAt(bytes, firstInvalid(bytes)) };
  }
  const sanitized = sanitizeSvg(text);
  if (!sanitized.svg) return refusal(sanitized.removed[0]?.reason);
  return { kind: 'svg', svg: sanitized.svg, ...walk(sanitized.svg), removed: sanitized.removed };
}

/** A figure with more of `what` than `limit`. */
function most(what: string, limit: number): Found {
  return {
    kind: 'tooLarge',
    why: `has more ${what} than ${count(limit)}, the most a figure may have`,
  };
}

/** What a figure `sanitizeSvg` refused whole for `reason` is. */
function refusal(reason: SvgReason | undefined): Found {
  switch (reason) {
    case 'root':
      return { kind: 'type', is: undefined };
    case 'size':
      return most('characters', SVG_LIMITS.size);
    case 'elements':
      return most('elements, or attributes,', SVG_LIMITS.elements);
    case 'depth':
      return {
        kind: 'tooLarge',
        why: `nests elements more than ${SVG_LIMITS.depth} deep, the most a figure may`,
      };
    case 'numbers':
      return most('numbers', SVG_LIMITS.numbers);
    case 'drawn':
      return {
        kind: 'tooLarge',
        why: `would draw more than a figure may: its elements, numbers, text and dashes, and its markers each time they're drawn, come to more than ${count(SVG_LIMITS.drawn)}`,
      };
    case 'aspect':
      return {
        kind: 'tooLarge',
        why: `is too tall or too wide to lay out: a figure is at most ${SVG_LIMITS.tallest} times as tall as it's wide, ${SVG_LIMITS.widest} times as wide as it's tall, and ${count(SVG_LIMITS.extent)} units either way`,
      };
    case 'script':
    case 'style':
    case 'reference':
    case 'element':
    case 'attribute':
    case 'value':
    case 'id':
    case undefined:
      // Removals leave a figure, so these never refuse one.
      return most('of what Lo reads', SVG_LIMITS.size);
    default:
      reason satisfies never;
      return most('of what Lo reads', SVG_LIMITS.size);
  }
}

/**
 * What a part can't be, by the element it names. A title or a description has no id to name it by.
 */
const UNLINKABLE: Readonly<Partial<Record<string, string>>> = {
  svg: 'the figure itself',
  defs: "the figure's definitions",
  marker: 'a marker',
  tspan: 'a span inside text',
};

/** Colors that aren't colors to draw in, so follow any theme. */
const COLORLESS = new Set(['none', 'currentColor', 'transparent']);

/** Lo's colors, as `sanitizeSvg` keeps them. */
const OWN_COLORS = new Set(FIGURE_COLORS.map((name) => `var(--${name})`));

/** How many colors that aren't Lo's a warning names. */
const COLORS_SHOWN = 3;

/**
 * The ids in `svg`, each with why Lo can't link it, if it can't: a part is a shape, a group or a
 * text drawn once, not the figure itself, its definitions, a marker or anything a marker draws, or
 * text inside text, which Lo can't wrap in a group of its own. And its colors that aren't Lo's.
 */
function walk(svg: SvgElement): { ids: Map<string, string | undefined>; colors: string[] } {
  const ids = new Map<string, string | undefined>();
  const colors = new Set<string>();
  const stack: { element: SvgElement; marker: boolean }[] = [{ element: svg, marker: false }];
  while (stack.length > 0) {
    const { element, marker } = stack.pop()!;
    const { name, attributes } = element;
    const rule = SVG_ELEMENTS[name].attributes;
    for (const [attribute, value] of Object.entries(attributes)) {
      const kind = Object.hasOwn(rule, attribute) ? rule[attribute] : undefined;
      if (
        (kind === 'paint' || kind === 'color') &&
        !COLORLESS.has(value) &&
        !OWN_COLORS.has(value) &&
        colors.size <= COLORS_SHOWN
      ) {
        colors.add(value);
      }
    }
    const id = attributes['id'];
    if (id !== undefined) {
      ids.set(id, marker && name !== 'marker' ? 'inside a marker' : UNLINKABLE[name]);
    }
    const inside = marker || name === 'marker';
    for (let i = element.children.length - 1; i >= 0; i--) {
      const child = element.children[i]!;
      if (child.kind === 'element') stack.push({ element: child, marker: inside });
    }
  }
  return { ids, colors: [...colors] };
}

function stateOf(reference: FigureReference, found: Found): FigureState {
  switch (found.kind) {
    case 'svg':
      if (found.removed.length > 0) return { state: 'leftOut', why: 'content' };
      return {
        state: 'kept',
        type: 'svg',
        svg: found.svg,
        parts: reference.parts
          .filter(({ id }) => found.ids.has(id) && found.ids.get(id) === undefined)
          .map(({ id }) => id),
      };
    case 'image':
      return { state: 'kept', type: found.type, width: found.width, height: found.height };
    case 'missing':
    case 'notFile':
    case 'type':
    case 'header':
    case 'encoding':
    case 'tooLarge':
      return { state: 'leftOut', why: found.kind };
    case 'unread':
      return { state: 'unread', why: found.why };
    default:
      found satisfies never;
      throw new Error(`Unknown figure ${JSON.stringify(found)}`);
  }
}

/** Each type's name, as a sentence gives it. */
const NAMES: Readonly<Record<FigureType, string>> = {
  svg: 'an SVG',
  png: 'a PNG',
  jpeg: 'a JPEG',
  gif: 'a GIF',
  webp: 'a WebP',
};

/** The endings a figure of each type is named with. */
const ENDINGS: Readonly<Record<FigureType, string>> = {
  svg: '.svg',
  png: '.png',
  jpeg: '.jpg or .jpeg',
  gif: '.gif',
  webp: '.webp',
};

/** Adds the findings for `reference`, showing the figure `found` says is there. */
function report(
  findings: Findings,
  reference: FigureReference,
  found: Found,
  otherCase: (path: string) => string,
): void {
  const { path, line } = reference;
  const shown = quote(path);
  switch (found.kind) {
    case 'missing':
      findings.add(
        'figure-missing',
        line,
        `${shown} isn't in the overview's commit.${otherCase(path)}`,
      );
      return;
    case 'notFile':
      findings.add('figure-not-file', line, `${shown} is ${article(found.is)}, not a file.`);
      return;
    case 'type': {
      const named = namedType(path);
      const { is } = found;
      findings.add(
        'figure-type',
        line,
        is === undefined
          ? named === 'svg'
            ? `${shown} isn't an SVG: it has no <svg> element at its top.`
            : `${shown} isn't ${NAMES[named]}: Lo reads a figure's type from its first bytes, and these aren't ${NAMES[named]}'s.`
          : `${shown} is ${NAMES[is]}, not ${NAMES[named]}. Name it with ${ENDINGS[is]}.`,
      );
      return;
    }
    case 'header':
      findings.add('figure-header', line, `${shown} ${found.why}, so Lo can't tell its size.`);
      return;
    case 'encoding':
      findings.add(
        'figure-encoding',
        line,
        `${shown} isn't UTF-8 from its line ${found.line} on. Lo reads an SVG only as UTF-8.`,
      );
      return;
    case 'tooLarge':
      findings.add('figure-too-large', line, `${shown} ${found.why}.`);
      return;
    case 'svg':
      if (found.removed.length > 0) {
        findings.add(
          'figure-content',
          line,
          `${shown} holds what a figure can't, so it's left out: ${removals(found.removed)}. figures.md says what a figure may hold.`,
        );
      }
      if (found.colors.length > 0) {
        const named = found.colors.slice(0, COLORS_SHOWN).map(quote).join(', ');
        const more = found.colors.length > COLORS_SHOWN ? ' and others' : '';
        findings.add(
          'figure-color',
          line,
          `${shown} draws in ${named}${more}, which won't follow the reader's theme. Draw in Lo's colors, var(--fig-*).`,
        );
      }
      for (const part of reference.parts) {
        const what = found.ids.get(part.id);
        if (!found.ids.has(part.id)) {
          findings.add(
            'figure-part-missing',
            part.line,
            `The part "${part.id}" isn't an id in ${shown}. Give the element it means that id.`,
          );
        } else if (what !== undefined) {
          findings.add(
            'figure-part-missing',
            part.line,
            `The part "${part.id}" is ${what} in ${shown}, which Lo can't link. Link a shape, a group or a text.`,
          );
        }
      }
      return;
    case 'image':
    case 'unread':
      // Nothing's wrong with an image that's kept, and a figure unread isn't the overview's doing.
      return;
    default:
      found satisfies never;
      throw new Error(`Unknown figure ${JSON.stringify(found)}`);
  }
}

/** How many removals a finding names. */
const REMOVALS_SHOWN = 3;

/** Why something was removed, in words. */
const REASONS: Readonly<Record<SvgReason, string>> = {
  script: 'a script',
  style: 'a style',
  reference: 'a reference outside the figure, or to nothing',
  element: "an element Lo doesn't draw",
  attribute: "an attribute Lo doesn't draw",
  value: "a value Lo doesn't draw",
  id: "an id used twice, or one that isn't a plain name",
  size: 'too large',
  elements: 'too large',
  depth: 'too large',
  numbers: 'too large',
  drawn: 'too large',
  aspect: 'too large',
  root: 'not an SVG',
};

/** The first few of `removed`, and how many more, in words. */
function removals(removed: readonly SvgRemoval[]): string {
  const named = removed.slice(0, REMOVALS_SHOWN).map((removal) => {
    const element = `<${quote(removal.element)}>`;
    const what =
      removal.attribute === undefined ? element : `${quote(removal.attribute)} on ${element}`;
    const where = removal.line === undefined ? '' : ` on line ${removal.line}`;
    return `${what}${where} (${REASONS[removal.reason]})`;
  });
  const more = removed.length - named.length;
  if (more === 0) return named.join('; ');
  const many = removed.length >= MAX_DIAGNOSTICS ? `${count(more)} or more` : count(more);
  return `${named.join('; ')}; and ${many} more`;
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

function kibibytes(bytes: number): string {
  return `${bytes / 1024} KiB`;
}

function mebibytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MiB`;
}
