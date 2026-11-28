// An overview's sections as the reader folds them. A fold by hand is kept for the tab, by heading,
// across revisions, and writes nothing; a section the reader hasn't folded starts collapsed when
// its heading is in `overview.collapsed` for the repo. The commands here fold them, from a key, a
// heading's chevron or its menu: one section, every section, and the two switches that write the
// setting, which fold the section now too. Anything that goes into a collapsed section expands it
// first, at once. The tl;dr never collapses.

import type { OverviewTree } from '@lo/artifact';
import type { Target } from '@lo/ui/commands';
import {
  blockNumber,
  sectionAt,
  sectionHeadOf,
  sectionsOf,
  type OverviewFolds,
  type OverviewSection,
} from '@lo/ui/overview';
import { generationOf } from '@lo/ui/markdown';
import { useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';

import { changeSetting, settingNow, useSetting } from '../../settings/window/shared.ts';
import { activeTab, tabState, useTabState, type PullTab } from '../../tab/window/shared.ts';
import {
  collapsed,
  entryKey,
  everywhere,
  holds,
  inRepo,
  listIn,
  readScoped,
  setEverywhere,
  setInRepo,
  type Scoped,
  type ScopedValue,
} from '../settings.ts';
import { blockId, blockIn } from './blocks.ts';
import { standingOf } from './facts.ts';
import { focusedBlock, type DrawnOverview } from './follow.ts';
import { checked, states } from './store.ts';

/** The tl;dr, as a heading in the setting is matched: it never collapses, whatever the setting says. */
const TLDR = entryKey('tl;dr');

/**
 * Each tab's sections folded by hand, by their heading as it's matched: `true` collapsed, `false`
 * expanded. A section with none follows the setting. Every section with that heading follows the
 * fold, in this revision and a newer one, wherever it is.
 */
export const folds = tabState<ReadonlyMap<string, boolean>>(() => new Map());

/**
 * Each tab's sections opened at once, as something went into them, by their heading's block
 * number, counted (`OverviewFolds.opened`).
 */
const opened = tabState<ReadonlyMap<number, number>>(() => new Map());

const keys = new WeakMap<readonly OverviewSection[], ReadonlyMap<number, string>>();

/** What each section of `sections` is folded by, by its heading's block number: its heading. */
function keysOf(sections: readonly OverviewSection[]): ReadonlyMap<number, string> {
  const kept = keys.get(sections);
  if (kept) return kept;
  const made = new Map(sections.map((section) => [section.heading, entryKey(section.name)]));
  keys.set(sections, made);
  return made;
}

/** The repo a pull request's tab is in, as the setting names it: `rozed-dev/e2e`. */
export function repoOf(tab: Pick<PullTab, 'owner' | 'repo'>): string {
  return `${tab.owner}/${tab.repo}`;
}

/** The setting as Lo reads it now. */
function scopedNow(): Scoped {
  return readScoped(settingNow(collapsed), collapsed.key).scoped;
}

/**
 * Whether the setting collapses a section with heading `name` in `repo`: it's in the repo's list,
 * and isn't the tl;dr.
 */
function listed(scoped: Scoped, repo: string, name: string): boolean {
  return entryKey(name) !== TLDR && holds(listIn(scoped, repo), name);
}

/**
 * The sections of `tree` collapsed now, by their heading's block number: those folded by hand as
 * `hand` says, and the rest as the setting says for `repo`.
 */
export function collapsedIn(
  tree: OverviewTree,
  hand: ReadonlyMap<string, boolean>,
  scoped: Scoped,
  repo: string,
): ReadonlySet<number> {
  const sections = sectionsOf(tree.blocks);
  const kept = keysOf(sections);
  const shut = new Set<number>();
  for (const section of sections) {
    if (!section.folds) continue;
    const key = kept.get(section.heading);
    const byHand = key === undefined ? undefined : hand.get(key);
    if (byHand ?? listed(scoped, repo, section.name)) shut.add(section.heading);
  }
  return shut;
}

/** Whether `section` of the overview tab `tab` shows is collapsed now. */
export function isCollapsed(tab: PullTab, tree: OverviewTree, section: OverviewSection): boolean {
  return collapsedIn(tree, folds.get(tab.id), scopedNow(), repoOf(tab)).has(section.heading);
}

/** Folds the sections of `sections` whose headings are `headings` by hand in tab `tab`. */
function foldByHand(
  tab: string,
  sections: readonly OverviewSection[],
  headings: readonly number[],
  collapse: boolean,
): void {
  const kept = keysOf(sections);
  folds.update(tab, (was) => {
    const next = new Map(was);
    for (const heading of headings) {
      const key = kept.get(heading);
      if (key !== undefined) next.set(key, collapse);
    }
    return next;
  });
}

/**
 * Expands the sections of `tree` whose headings are `headings` at once in tab `tab`, as going into
 * one does: by hand, and counted, so each is drawn open from the start.
 */
function expandAtOnce(tab: string, tree: OverviewTree, headings: readonly number[]): void {
  opened.update(tab, (was) => {
    const next = new Map(was);
    for (const heading of headings) next.set(heading, (next.get(heading) ?? 0) + 1);
    return next;
  });
  foldByHand(tab, sectionsOf(tree.blocks), headings, false);
}

/**
 * Expands the collapsed section block `block` of `tree` is in at once, in the overview tab `tab`
 * shows, so it's drawn for something to go to it, as `⌃o` back to it, or a note in the diff. Its
 * heading stays collapsed, a block itself. The caller draws it, in `flushSync`.
 */
export function openTo(tab: PullTab, tree: OverviewTree, block: number): void {
  const section = sectionAt(sectionsOf(tree.blocks), block);
  if (section?.folds && section.heading !== block && isCollapsed(tab, tree, section)) {
    expandAtOnce(tab.id, tree, [section.heading]);
  }
}

/** The block number of the glossary under `tree`'s Glossary heading, if it has one. */
export function glossaryBlock(tree: OverviewTree): number | undefined {
  const at = tree.blocks.findIndex((block) => block.kind === 'glossary');
  return at === -1 ? undefined : at;
}

/**
 * Expands the overview's Glossary in the tab `tab`, if it's collapsed, drawn now, so Go to glossary
 * has its terms to go to.
 */
export function openGlossary(tab: PullTab, overview: DrawnOverview): void {
  const at = glossaryBlock(overview.tree);
  if (at !== undefined) flushSync(() => openTo(tab, overview.tree, at));
}

/**
 * As {@link openTo}, in the overview main last said tab `tab` has, whether it's drawn yet or not:
 * history and a note's "Show in overview" go there from the diff or the timeline, before the
 * overview has ever been shown. In the tab on screen, where they are.
 */
export function openShown(tab: string, block: number): void {
  const pull = activeTab();
  const standing = standingOf(states.get(tab), checked.get(tab));
  if (pull?.kind === 'pull' && pull.id === tab && standing.kind === 'shown') {
    openTo(pull, standing.parsed.tree, block);
  }
}

/**
 * How the overview tab `tab` shows folds its sections: the setting's, for its repo, and the tab's
 * own by hand. Expanding a section, as going into one does, is a fold by hand. The same object for
 * as long as what it says is the same.
 */
export function useFolds(tab: PullTab, tree: OverviewTree): OverviewFolds {
  const hand = useTabState(folds, tab.id);
  const atOnce = useTabState(opened, tab.id);
  const value = useSetting(collapsed);
  const repo = repoOf(tab);
  const scoped = useMemo(() => readScoped(value, collapsed.key).scoped, [value]);
  const shut = useMemo(() => collapsedIn(tree, hand, scoped, repo), [tree, hand, scoped, repo]);
  const generation = generationOf(tree);
  const id = tab.id;
  const fold = useCallback(
    (heading: number) => ({
      command: 'overview.foldSection',
      target: { kind: 'block' as const, block: blockId(generation, heading) },
    }),
    [generation],
  );
  const expand = useCallback(
    (headings: readonly number[]) => expandAtOnce(id, tree, headings),
    [id, tree],
  );
  // A new set only when another section is collapsed, so the article isn't drawn again for nothing.
  const said = [...shut].join(' ');
  return useMemo(
    () => ({
      collapsed: new Set(said === '' ? [] : said.split(' ').map(Number)),
      fold,
      expand,
      opened: atOnce,
    }),
    [said, fold, expand, atOnce],
  );
}

/** How far under the top of the article a section's heading may be, and still be the current one. */
const CURRENT_WITHIN_PX = 48;

/** The heads of the overview's sections, as its article draws them, first to last. */
function headsIn(overview: DrawnOverview): HTMLElement[] {
  return [...(overview.scroller()?.querySelectorAll<HTMLElement>('[data-lo-section]') ?? [])];
}

/** A head's section's heading, by its block number. */
function headingOf(head: Element): number | undefined {
  const value = head.getAttribute('data-lo-section');
  return value === null || !/^\d+$/.test(value) ? undefined : Number(value);
}

/**
 * The section the outline marks as current: the last whose heading has reached the top of the
 * article, or the first.
 */
function currentIn(overview: DrawnOverview): number | undefined {
  const scroller = overview.scroller();
  if (!scroller) return undefined;
  const top = scroller.getBoundingClientRect().top;
  const heads = headsIn(overview);
  let at = heads[0];
  for (const head of heads) {
    if (head.getBoundingClientRect().top - top > CURRENT_WITHIN_PX) break;
    at = head;
  }
  return at && headingOf(at);
}

/**
 * The section a command acts on in `overview`: the heading `target` names, or the section the block
 * it names is in. With none, the one the keyboard is in: the heading or block that has focus, else
 * the one the outline marks as current.
 */
export function sectionFor(overview: DrawnOverview, target: Target): OverviewSection | undefined {
  const sections = sectionsOf(overview.tree.blocks);
  if (target.kind === 'block') {
    const index = blockIn(target.block, overview.generation);
    return index === undefined ? undefined : sectionAt(sections, index);
  }
  const head = sectionHeadOf(document.activeElement);
  const headed = head && overview.root.contains(head) ? headingOf(head) : undefined;
  const block = focusedBlock(overview);
  const at = headed ?? (block && blockNumber(block)) ?? currentIn(overview);
  return at === undefined ? undefined : sectionAt(sections, at);
}

/**
 * What a right-click on `element` in the overview is on, where it's on the heading of a section
 * that folds: that heading, as a block. The tl;dr's has no menu.
 */
export function headTarget(overview: DrawnOverview, element: Element): Target | undefined {
  const head = sectionHeadOf(element);
  const heading = head && overview.root.contains(head) ? headingOf(head) : undefined;
  if (heading === undefined) return undefined;
  const section = sectionAt(sectionsOf(overview.tree.blocks), heading);
  return section?.folds && section.heading === heading
    ? { kind: 'block', block: blockId(overview.generation, heading) }
    : undefined;
}

/** Whether `target` is the heading of a section that folds: what a heading's menu is on. */
export function isHeading(overview: DrawnOverview, target: Target): boolean {
  if (target.kind !== 'block') return false;
  const index = blockIn(target.block, overview.generation);
  const section =
    index === undefined ? undefined : sectionAt(sectionsOf(overview.tree.blocks), index);
  return section?.folds === true && section.heading === index;
}

/** The element of `section`'s heading in the overview, as drawn. */
function headIn(overview: DrawnOverview, section: OverviewSection): HTMLElement | undefined {
  return headsIn(overview).find((head) => headingOf(head) === section.heading);
}

/** Whether the keyboard is in what's under `section`'s heading: a block there has focus. */
function keyboardIn(overview: DrawnOverview, section: OverviewSection): boolean {
  const block = focusedBlock(overview);
  const at = block && blockNumber(block);
  return at !== undefined && section.from <= at && at < section.to;
}

/** The room the article keeps over a heading brought to its top, as its scroll padding does. */
const TOP_ROOM = 24;

/**
 * As `section` collapses with the keyboard in it, or on its heading, its heading takes focus, as
 * the block the keys are at now, since what had it goes; and a heading above the screen comes back
 * to its top, so the reader sees what they folded.
 */
function leaveFor(overview: DrawnOverview, section: OverviewSection, inside: boolean): void {
  const head = headIn(overview, section);
  const scroller = overview.scroller();
  if (!head || !scroller) return;
  if (inside || head.contains(document.activeElement)) {
    head.querySelector<HTMLElement>(':scope > h2')?.focus({ preventScroll: true });
  }
  const above = head.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  if (above < 0) scroller.scrollTop += above - TOP_ROOM;
}

/**
 * Collapses `section` of the overview tab `tab` shows, or expands it, by hand. Collapsing it with
 * the keyboard in it, or reading it from further down, brings its heading back.
 */
export function foldSection(
  tab: string,
  overview: DrawnOverview,
  section: OverviewSection,
  collapse: boolean,
): void {
  if (!section.folds) return;
  const inside = keyboardIn(overview, section);
  // Drawn now, so the heading that takes focus is the block it's become.
  flushSync(() => foldByHand(tab, sectionsOf(overview.tree.blocks), [section.heading], collapse));
  if (collapse) leaveFor(overview, section, inside);
}

/**
 * Collapses every section of the overview tab `tab` shows but the tl;dr, or expands every one. The
 * section the keyboard is in, collapsing, gives its heading focus, and brings it back on screen.
 */
export function foldAll(tab: string, overview: DrawnOverview, collapse: boolean): void {
  const sections = sectionsOf(overview.tree.blocks);
  const folding = sections.filter((section) => section.folds);
  const at = collapse ? sectionFor(overview, { kind: 'none' }) : undefined;
  const inside = at !== undefined && keyboardIn(overview, at);
  const headings = folding.map((section) => section.heading);
  flushSync(() => foldByHand(tab, sections, headings, collapse));
  if (at?.folds) leaveFor(overview, at, inside);
}

/** Changes to the setting waiting their turn, so each is made to the one before it. */
let writing: Promise<unknown> = Promise.resolve();

/**
 * Changes the setting as `change` says, once the changes before it have been saved, from its value
 * then: main says each value back before it answers, so none is lost to a quick second change. A
 * change it refuses is said in a toast.
 */
function changeCollapsed(change: (value: ScopedValue) => ScopedValue): Promise<boolean> {
  const made = writing.then(() => changeSetting(collapsed, change(settingNow(collapsed))));
  writing = made.catch(() => false);
  return made;
}

/** Whether `section` collapses in tab `tab`'s repo by the setting: "Collapse in this repo". */
export function inThisRepo(tab: PullTab, section: OverviewSection): boolean {
  return inRepo(scopedNow(), repoOf(tab), section.name);
}

/** Whether `section` collapses in every repo by the setting: "Collapse in every repo". */
export function inEveryRepo(section: OverviewSection): boolean {
  return everywhere(scopedNow(), section.name);
}

/**
 * Turns "Collapse in this repo" or "Collapse in every repo" for `section`: writes the setting, and
 * collapses the section now as it's turned on, or expands it as it's turned off.
 */
export function foldIn(
  tab: PullTab,
  overview: DrawnOverview,
  section: OverviewSection,
  where: 'repo' | 'every',
): void {
  const repo = repoOf(tab);
  const on = where === 'repo' ? inThisRepo(tab, section) : inEveryRepo(section);
  foldSection(tab.id, overview, section, !on);
  void changeCollapsed((value) =>
    where === 'repo'
      ? setInRepo(value, repo, section.name, !on)
      : setEverywhere(value, section.name, !on),
  );
}
