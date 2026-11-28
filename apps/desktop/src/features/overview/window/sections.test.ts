// Which of an overview's sections are collapsed: those the reader folded by hand in the tab, by
// heading, and the rest as `overview.collapsed` says for the repo. The tl;dr never is.

import { describe, expect, it } from 'vitest';

import { parseArtifact, type OverviewTree } from '@lo/artifact';
import { sectionsOf } from '@lo/ui/overview';

import { readScoped, type ScopedValue } from '../settings.ts';
import { collapsedIn } from './sections.ts';

/** An overview with `headings`, each over a paragraph. */
function overview(...headings: string[]): OverviewTree {
  const head = `---\nformat: 1\npr: 4797\ncommit: ${'a'.repeat(40)}\n---\n`;
  const body = headings.map((heading) => `## ${heading}\n\nSomething under ${heading}.\n`);
  return parseArtifact([head, ...body].join('\n')).tree;
}

const scoped = (value: ScopedValue) => readScoped(value, 'overview.collapsed').scoped;

/** The names of the sections of `tree` collapsed. */
function shut(
  tree: OverviewTree,
  value: ScopedValue,
  hand: ReadonlyMap<string, boolean> = new Map(),
  repo = 'rozed-dev/e2e',
): string[] {
  const collapsed = collapsedIn(tree, hand, scoped(value), repo);
  return sectionsOf(tree.blocks)
    .filter((section) => collapsed.has(section.heading))
    .map((section) => section.name);
}

describe('the sections collapsed', () => {
  it('start as the repo’s list says, matched as plain text', () => {
    const tree = overview('tl;dr', 'How it works', 'Testing', 'Rollout');
    expect(shut(tree, {})).toEqual([]);
    expect(shut(tree, { '*': ['testing', 'ROLLOUT'] })).toEqual(['Testing', 'Rollout']);
    // A repo's own list replaces every repo's there.
    const value = { '*': ['Testing'], 'rozed-dev/e2e': ['How  it works'] };
    expect(shut(tree, value)).toEqual(['How it works']);
    expect(shut(tree, value, new Map(), 'fieldwork/atlas-api')).toEqual(['Testing']);
  });

  it('never include the tl;dr, whatever the list says', () => {
    expect(shut(overview('tl;dr', 'Testing'), { '*': ['tl;dr', 'TL;DR', 'Testing'] })).toEqual([
      'Testing',
    ]);
  });

  it('collapse every section with a heading the list has', () => {
    expect(shut(overview('tl;dr', 'Notes', 'Testing', 'Notes'), { '*': ['notes'] })).toEqual([
      'Notes',
      'Notes',
    ]);
  });

  it('follow a fold by hand over the list, by heading, for every section with it', () => {
    const tree = overview('tl;dr', 'Notes', 'Testing', 'Notes');
    const hand = new Map([
      ['notes', true],
      ['testing', false],
    ]);
    expect(shut(tree, { '*': ['Testing'] }, hand)).toEqual(['Notes', 'Notes']);
    // In a newer revision, every section with that heading follows it, wherever it is and however
    // many there are, so no fold lands on a section of another heading.
    const newer = overview('tl;dr', 'Notes', 'Testing', 'More', 'Notes', 'Notes');
    expect(shut(newer, { '*': ['Testing'] }, hand)).toEqual(['Notes', 'Notes', 'Notes']);
    expect(shut(overview('tl;dr', 'Testing', 'Notes'), { '*': ['Testing'] }, hand)).toEqual([
      'Notes',
    ]);
    // A heading the reader folded open stays open there, though the list has it.
    expect(shut(overview('tl;dr', 'Testing'), { '*': ['testing'] }, hand)).toEqual([]);
  });
});
