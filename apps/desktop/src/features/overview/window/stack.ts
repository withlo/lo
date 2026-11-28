// The overview of the stack each view of a pull request's tab is a layer of, in the window:
//
// - Which stack's it is: the one the layer's own overview names, else the one the lowest layer
//   whose overview names one does. Each layer's overview is read once while its ref holds the same
//   commit, as the stack's tree marks it, and read in the background process for the stack it names
//   and its tl;dr, which the stack overview's Layers shows with each layer's description's first
//   line for a layer whose overview says none.
// - What main says of it, followed beside the layer's own and checked as that is.
// - Which of the two the view's Overview shows, its subject: `g s`, the stack's row and the notice
//   set it to the stack, and showing a layer sets it back to that layer's own. Each change is a
//   place in the tab's history.
//
// A view's stack overview and what was read of its layers go as the view closes.

import type { OverviewBlock, OverviewTree, ParsedArtifact } from '@lo/artifact';
import { plainText } from '@lo/markdown';

import { registry, here } from '../../../window/commands/registry.ts';
import type { Row, StackView } from '../../stacks/contract.ts';
import { tabState } from '../../tab/window/shared.ts';
import { LAYERS_LIMIT, type OverviewState } from '../contract.ts';
import { Checking, type CheckedOverview } from './checking.ts';
import { standingOf, type Standing } from './facts.ts';
import { main, overviewJobs } from './main.ts';
import { steady } from './steady.ts';
import { checked, states } from './store.ts';

/** What a view's Overview shows: its layer's own overview, or its stack's. */
export type Showing = 'pull' | 'stack';

/** What each view's Overview shows. */
export const subjects = tabState<Showing>(() => 'pull');

/** What main last said of the overview of each view's stack: none until it has. */
export const stackStates = tabState<OverviewState | undefined>(() => undefined);

/** Each view's stack's overview, checked, as `checked` holds a layer's own. */
export const stackChecked = tabState<CheckedOverview | undefined>(() => undefined);

/** Whether main is reading each view's stack's overview again, until it has. */
export const stackRereading = tabState<boolean>(() => false);

/** What a layer of the stack says of itself, for Layers and for which stack overview shows. */
export interface LayerSaid {
  /** The stack its overview names, if it names one. */
  readonly stack: number | undefined;
  /** Its overview's tl;dr, as text on one line, if it has one Lo could read. */
  readonly tldr: string | undefined;
  /** Its description's first line: none when it has none, undefined until it's read. */
  readonly line: string | null | undefined;
}

const NOTHING_SAID: ReadonlyMap<number, LayerSaid> = new Map();

/** What each view's stack's layers say, by number: a layer missing from it is still being read. */
export const layersSaid = tabState<ReadonlyMap<number, LayerSaid>>(() => NOTHING_SAID);

/** The stack each view follows the overview of, as main was last asked: none for none. */
const following = new Map<string, number | null>();
/** Each view's stack's overview's checking. */
const checkings = new Map<string, Checking>();
/** What was last read of each view's layers, so it's read again only as it changes. */
const readFor = new Map<string, string>();
/** Each view's layers whose descriptions were asked for. */
const linesAsked = new Map<string, Set<number>>();
/**
 * What each overview's commit says, read once: by the commit, and the layer whose ref held it. The
 * last {@link PARSED_LIMIT} read are kept.
 */
const parsedAt = new Map<string, Promise<Omit<LayerSaid, 'line'>>>();

/** The most overviews' commits {@link parsedAt} keeps what they say of. */
const PARSED_LIMIT = 200;

/** Whether the window takes what main says of overviews: not while Settings turns them off. */
let taking = true;

/** The most characters of a tl;dr that Layers is given: three lines of it at most show. */
const TLDR_LIMIT = 600;

/** How often the view on screen reads its layers' overviews again, in milliseconds. */
export const LAYERS_AGAIN_MS = 60_000;

/** The stack's overview of view `id`, as main last said and its check found. */
export function stackStandingOf(id: string): Standing {
  return standingOf(stackStates.get(id), stackChecked.get(id));
}

/**
 * Whether view `id`'s stack has an overview Lo has read, which its row then offers: one whose ref
 * holds a commit, or whose last commit Lo kept.
 */
export function hasStackOverview(id: string): boolean {
  return (stackStates.get(id)?.overview ?? null) !== null;
}

/** What view `id`'s Overview shows now: its stack's only while it has one. */
export function subjectNow(id: string): Showing {
  return subjects.get(id) === 'stack' && hasStackOverview(id) ? 'stack' : 'pull';
}

/**
 * Shows view `id`'s `subject` in its Overview, recording where it was in its history first when it
 * changes: the view's own overview again as one of its layers is shown, or its stack's.
 */
export function setSubject(id: string, subject: Showing): void {
  if (subjectNow(id) === subject) {
    subjects.set(id, subject);
    return;
  }
  const from = here();
  if (from) registry().history.record(from);
  subjects.set(id, subject);
}

/** Each stack overview's tree with its Layers section, made once for the tree as parsed. */
const withLayersOf = new WeakMap<OverviewTree, OverviewTree>();
/** The block of each tree with Layers that the list of layers is drawn in place of. */
const layersBlocks = new WeakMap<OverviewTree, OverviewBlock>();

/**
 * `tree`, a stack overview's, with Lo's Layers section after its tl;dr: a heading, "Layers", in the
 * outline, under an anchor no other heading has, and the block the list of layers is drawn in
 * place of. The same tree each time for the same tree, so its blocks keep their ids.
 */
export function withLayers(tree: OverviewTree): OverviewTree {
  const made = withLayersOf.get(tree);
  if (made) return made;
  const { blocks } = tree;
  const anchors = new Set(
    blocks.flatMap((block) => (block.kind === 'heading' ? [block.anchor] : [])),
  );
  let anchor = 'layers';
  for (let count = 1; anchors.has(anchor); count++) anchor = `layers-${count}`;
  const heading: OverviewBlock = {
    kind: 'heading',
    level: 2,
    anchor,
    children: [{ kind: 'text', value: 'Layers' }],
  };
  const list: OverviewBlock = { kind: 'paragraph', children: [] };
  // After the tl;dr, which is first: before the next heading of its level.
  const first = blocks[0];
  const tldr = first?.kind === 'heading' && first.level === 2 && first.anchor === 'tldr';
  const next = blocks.findIndex(
    (block, at) => at > 0 && block.kind === 'heading' && block.level <= 2,
  );
  const at = tldr ? (next < 0 ? blocks.length : next) : 0;
  const shown: OverviewTree = {
    ...tree,
    blocks: [...blocks.slice(0, at), heading, list, ...blocks.slice(at)],
  };
  withLayersOf.set(tree, shown);
  layersBlocks.set(shown, list);
  return shown;
}

/** The block of `tree`, one {@link withLayers} made, that the list of layers is drawn in place of. */
export function layersBlockOf(tree: OverviewTree): OverviewBlock | undefined {
  return layersBlocks.get(tree);
}

/** `standing`, a stack overview's, with its Layers section in its tree once it shows. */
export function withLayersShown(standing: Standing): Standing {
  if (standing.kind !== 'shown') return standing;
  const parsed: ParsedArtifact = { ...standing.parsed, tree: withLayers(standing.parsed.tree) };
  return { ...standing, parsed };
}

/** The text of `blocks`, the tl;dr's, on one line. */
function textOf(blocks: readonly OverviewBlock[]): string | undefined {
  const text = plainText({ blocks: [...blocks], notes: [], diagnostics: [] }, TLDR_LIMIT);
  return text === '' ? undefined : text;
}

/** The tl;dr's blocks in `blocks`: those under its heading, up to the next of its level. */
export function tldrOf(blocks: readonly OverviewBlock[]): string | undefined {
  const [first] = blocks;
  if (first?.kind !== 'heading' || first.level !== 2 || first.anchor !== 'tldr') return undefined;
  const end = blocks.findIndex(
    (block, at) => at > 0 && block.kind === 'heading' && block.level <= 2,
  );
  return textOf(blocks.slice(1, end < 0 ? undefined : end));
}

/** What the overview of layer `number`, `artifact` at `commit`, says: read once for the commit. */
function parsedOf(
  number: number,
  commit: string,
  artifact: Uint8Array,
): Promise<Omit<LayerSaid, 'line'>> {
  const key = `${number} ${commit}`;
  let parsed = parsedAt.get(key);
  if (!parsed) {
    parsed = overviewJobs()
      .parse({ artifact })
      .then(({ parsed: read }) => {
        // An overview on a layer's ref that names another pull request isn't that layer's.
        const header = read.header?.pr === number ? read.header : undefined;
        return { stack: header?.stack, tldr: header && tldrOf(read.tree.blocks) };
      })
      .catch((error: unknown) => {
        parsedAt.delete(key);
        console.error("Lo couldn't read a layer's overview:", error);
        return { stack: undefined, tldr: undefined };
      });
    parsedAt.set(key, parsed);
    // The oldest goes first: a Map keeps the order its keys were set in.
    for (const old of parsedAt.keys()) {
      if (parsedAt.size <= PARSED_LIMIT) break;
      parsedAt.delete(old);
    }
  }
  return parsed;
}

/** The rows of view `id`'s stack, while it's in one. */
function rowsOf(view: StackView | undefined): readonly Row[] {
  return view?.kind === 'stack' ? view.rows : [];
}

/** What the stack's rows say of their overviews, which changes what's read of them. */
function keyOf(rows: readonly Row[]): string {
  return rows.map((row) => `${row.number}:${row.head}:${String(row.overview)}`).join(' ');
}

/** What a layer says while what its overview says isn't known: nothing of a stack or a tl;dr. */
const UNKNOWN: Omit<LayerSaid, 'line'> = { stack: undefined, tldr: undefined };

/** Whether `a` and `b` say the same of each layer. */
function sameSaid(a: ReadonlyMap<number, LayerSaid>, b: ReadonlyMap<number, LayerSaid>): boolean {
  if (a.size !== b.size) return false;
  for (const [number, layer] of a) {
    const other = b.get(number);
    if (
      other === undefined ||
      other.stack !== layer.stack ||
      other.tldr !== layer.tldr ||
      other.line !== layer.line
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Sets what view `id`'s layers say to `said`, unless they say that already: setting it runs what
 * follows it, which reads them again only as it changes.
 */
function setSaid(id: string, said: ReadonlyMap<number, LayerSaid>): void {
  if (!sameSaid(layersSaid.get(id), said)) layersSaid.set(id, said);
}

/** Asks for `layers` in requests of at most {@link LAYERS_LIMIT} each, the replies in order. */
function inParts<T>(
  layers: readonly number[],
  ask: (part: number[]) => Promise<readonly T[]>,
): Promise<T[]> {
  const parts: number[][] = [];
  for (let at = 0; at < layers.length; at += LAYERS_LIMIT) {
    parts.push(layers.slice(at, at + LAYERS_LIMIT));
  }
  return Promise.all(parts.map(ask)).then((replies) => replies.flat());
}

/**
 * Reads what view `id`'s layers' overviews say, as `view`, its stack, lists them, unless it's read
 * them already for the stack as it is: each layer whose overview Lo can see. One without is said at
 * once, with no tl;dr. `again` reads them whatever was read before, as the stack's overview is
 * shown and every {@link LAYERS_AGAIN_MS} while the view is on screen, so an overview pushed since
 * is read. When none of them could be read, they're read again as anything changes. A layer whose
 * overview couldn't be read keeps what it said before.
 */
export function readLayers(id: string, view: StackView | undefined, again = false): void {
  const rows = rowsOf(view);
  const key = keyOf(rows);
  if (!again && readFor.get(id) === key) return;
  readFor.set(id, key);
  if (rows.length === 0) {
    if (layersSaid.get(id) !== NOTHING_SAID) layersSaid.set(id, NOTHING_SAID);
    return;
  }
  const kept = layersSaid.get(id);
  // A layer with no overview Lo can see says nothing of one.
  const said = new Map<number, LayerSaid>();
  for (const row of rows) {
    const known = kept.get(row.number);
    if (row.overview !== true) said.set(row.number, { ...UNKNOWN, line: known?.line });
    else if (known) said.set(row.number, known);
  }
  setSaid(id, said);
  const reading = rows.filter((row) => row.overview === true).map((row) => row.number);
  if (reading.length === 0) return;
  inParts(reading, (layers) => main().layerOverviews({ id, layers }))
    .then(async (read) => {
      const parsed = await Promise.all(
        read.map((overview, at) =>
          overview.kind === 'read'
            ? parsedOf(reading[at] ?? 0, overview.commit, overview.artifact)
            : Promise.resolve(undefined),
        ),
      );
      if (readFor.get(id) !== key) return;
      // None could be read now, as when GitHub can't be reached: read again as anything changes.
      if (read.every((overview) => overview.kind === 'unread')) readFor.delete(id);
      const next = new Map(layersSaid.get(id));
      read.forEach((overview, at) => {
        const number = reading[at];
        if (number === undefined) return;
        const was = next.get(number);
        const now = overview.kind === 'unread' ? (was ?? UNKNOWN) : (parsed[at] ?? UNKNOWN);
        next.set(number, { stack: now.stack, tldr: now.tldr, line: was?.line });
      });
      setSaid(id, next);
    })
    .catch((error: unknown) => {
      console.error("Lo couldn't read the stack's layers' overviews:", error);
      if (readFor.get(id) !== key) return;
      readFor.delete(id);
      // What they say is unknown: Layers falls back to their descriptions.
      const next = new Map(layersSaid.get(id));
      for (const number of reading) {
        if (!next.has(number)) next.set(number, { ...UNKNOWN, line: undefined });
      }
      setSaid(id, next);
    });
}

/**
 * Reads what view `id`'s layers' overviews say again, as `view` lists them, while overviews are on:
 * every {@link LAYERS_AGAIN_MS} for the view on screen.
 */
export function readLayersAgain(id: string, view: StackView | undefined): void {
  if (taking) readLayers(id, view, true);
}

/**
 * Reads the first line of the descriptions of view `id`'s layers whose overview gives no tl;dr,
 * once each while the view is open, for Layers.
 */
export function readLines(id: string, view: StackView | undefined): void {
  const said = layersSaid.get(id);
  const asked = linesAsked.get(id) ?? new Set<number>();
  linesAsked.set(id, asked);
  const wanted = rowsOf(view)
    .map((row) => row.number)
    .filter((number) => {
      const layer = said.get(number);
      return layer !== undefined && layer.tldr === undefined && !asked.has(number);
    });
  if (wanted.length === 0) return;
  for (const number of wanted) asked.add(number);
  inParts(wanted, (layers) => main().layerLines({ id, layers }))
    .then((lines) => {
      const next = new Map(layersSaid.get(id));
      lines.forEach((line, at) => {
        const number = wanted[at];
        const layer = number === undefined ? undefined : next.get(number);
        if (number !== undefined && layer) next.set(number, { ...layer, line });
      });
      layersSaid.set(id, next);
    })
    .catch((error: unknown) => {
      for (const number of wanted) asked.delete(number);
      console.error("Lo couldn't read the stack's layers' descriptions:", error);
    });
}

/**
 * The stack the layer's own overview, `own`, names: none for one that names none, can't be shown,
 * or isn't the repository's own, since a fork's overview names what its writer likes; unknown while
 * it's read and checked.
 */
export function namedBy(own: Standing): number | null | undefined {
  if (own.kind === 'reading' || own.kind === 'checking') return undefined;
  if (own.kind !== 'shown' || own.commit.source !== 'base') return null;
  return own.header.stack ?? null;
}

/**
 * The stack whose overview a view shows, of `view`, the stack it's in: `named`, the one its layer's
 * own overview names, else the one the lowest layer whose overview names one does. Unknown until
 * the layer's own overview has been read and checked; none while no layer names one.
 */
export function stackOf(
  view: StackView | undefined,
  named: number | null | undefined,
  said: ReadonlyMap<number, LayerSaid>,
): number | null | undefined {
  if (view?.kind !== 'stack') return null;
  if (named === undefined) return undefined;
  if (named !== null) return named;
  for (const row of view.rows) {
    const lowest = said.get(row.number)?.stack;
    if (lowest !== undefined) return lowest;
  }
  return null;
}

/** Follows the overview of the stack view `id` is in, as `view` and what its layers say name it. */
export function followStackOf(id: string, view: StackView | undefined): void {
  if (!taking) return;
  readLayers(id, view);
  const named = namedBy(standingOf(states.get(id), checked.get(id)));
  const stack = stackOf(view, named, layersSaid.get(id));
  if (stack === undefined || following.get(id) === stack) return;
  following.set(id, stack);
  stopChecking(id);
  stackStates.set(id, undefined);
  stackChecked.set(id, undefined);
  main()
    .followStack({ id, stack })
    .then(() => (stack === null ? undefined : main().currentStack({ id })))
    .then((state) => {
      // What main published meanwhile is newer.
      if (state && following.get(id) === stack && !stackStates.get(id)) takeStackState(state);
    })
    .catch((error: unknown) => {
      if (following.get(id) === stack) following.delete(id);
      console.error("Lo couldn't follow the stack's overview:", error);
    });
}

/** The stack whose overview view `id` follows, if it follows one. */
export function followedStack(id: string): number | undefined {
  return following.get(id) ?? undefined;
}

/** View `id`'s stack's overview's checking, made the first time it's needed. */
function checkingOf(id: string): Checking {
  let checking = checkings.get(id);
  if (checking) return checking;
  checking = new Checking(id, {
    files: (input) => main().files(input),
    code: (input) => main().code({ ...input, stack: true }),
    parse: (input, signal) => overviewJobs().parse(input, { signal }),
    check: (input, signal) => overviewJobs().check(input, { signal }),
    publish: (value) => {
      const kept = steady(stackChecked.get(id), value);
      if (kept !== stackChecked.get(id)) stackChecked.set(id, kept);
    },
    log: (message, error) => console.error(message, error),
  });
  checkings.set(id, checking);
  return checking;
}

function stopChecking(id: string): void {
  checkings.get(id)?.stop();
  checkings.delete(id);
}

/** Takes what main says of a view's stack's overview, while it follows that stack's. */
export function takeStackState(state: OverviewState): void {
  if (!taking) return;
  const stack = following.get(state.id);
  if (stack === undefined || stack === null || state.ref !== `refs/lo/stack/${stack}`) return;
  stackStates.set(state.id, state);
  checkingOf(state.id).take(state);
}

/**
 * Checks view `id`'s stack's overview again after a check that failed, settling once that check is
 * done.
 */
export async function checkStackAgain(id: string): Promise<void> {
  const state = stackStates.get(id);
  if (!state) return;
  const checking = checkingOf(id);
  checking.take(state);
  await checking.done();
}

/** Asks main to read view `id`'s stack's overview again now, as Try now and Check again do. */
export function readStackAgain(id: string): void {
  if (stackRereading.get(id)) return;
  stackRereading.set(id, true);
  main()
    .retry({ id, stack: true })
    .catch((error: unknown) => console.error("Lo couldn't read the stack's overview again:", error))
    .finally(() => stackRereading.set(id, false));
}

/** Forgets view `id`'s stack's overview and what was read of its layers. */
function forget(id: string): void {
  stopChecking(id);
  following.delete(id);
  readFor.delete(id);
  linesAsked.delete(id);
  stackStates.set(id, undefined);
  stackChecked.set(id, undefined);
  layersSaid.set(id, NOTHING_SAID);
  subjects.set(id, 'pull');
}

/** Takes what main says again as Settings turns overviews on; forgets every view's as it turns them off. */
export function takeStackOverviews(on: boolean): void {
  taking = on;
  if (on) return;
  for (const id of following.keys()) forget(id);
}

/** Forgets the views that closed: those not in `open`. */
export function keepStacksOnly(open: ReadonlySet<string>): void {
  for (const id of [...following.keys(), ...readFor.keys()]) if (!open.has(id)) forget(id);
}
