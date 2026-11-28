// What an overview's document shows for each term with the repo's definitions: the definition, its
// tags, the one a Changed term replaces, and who it's by, or a wait while they're read.

import { definitionBlocks } from '@lo/artifact';
import { describe, expect, it } from 'vitest';

import type { StoredTerm } from '../jobs.ts';
import type { ShownTerm } from './definitions.ts';
import { shownOf } from './Glossary.tsx';

const REPO = { owner: 'rozed-dev', name: 'e2e' };
const DAY = 24 * 60 * 60_000;
const AT = '2026-11-20T10:00:00Z';

/** A term the repo's definitions hold, with `more`. */
function stored(more: Partial<StoredTerm> = {}): StoredTerm {
  return {
    key: 'bucket',
    term: 'Bucket',
    definition: 'The tokens a tenant has.',
    blocks: definitionBlocks('The tokens a tenant has.') ?? [],
    aliases: [],
    written: 'agent',
    by: { login: 'ravi-k' },
    from: 264,
    at: AT,
    suggestions: [],
    changes: [],
    ...more,
  };
}

/** What the overview shows for Bucket, the repo's definition, with `more`. */
function term(more: Partial<ShownTerm> = {}): ShownTerm {
  const held = stored();
  return {
    key: 'bucket',
    name: 'Bucket',
    source: 'store',
    blocks: held.blocks,
    tag: undefined,
    before: undefined,
    stored: held,
    byline: { written: held.written, by: held.by, from: held.from, at: held.at },
    own: undefined,
    ignored: false,
    ...more,
  };
}

describe('what a term shows', () => {
  it('has the repo’s definition, its tags, and who it’s by, as of now', () => {
    const shown = shownOf(term(), false, Date.parse(AT) + 3 * DAY, REPO);
    expect(shown).toMatchObject({
      source: 'store',
      name: 'Bucket',
      marks: { mark: undefined, locked: false, suggestions: 0 },
      byline: { by: { login: 'ravi-k' }, written: 'agent', pull: { number: 264 }, when: '3 d ago' },
    });
    expect(shown.byline).toHaveProperty('pull.onOpen', expect.any(Function));
  });

  it('tags a locked term and its suggestions, and a Changed one with what it replaces', () => {
    const suggestion = {
      definition: 'A pool.',
      blocks: definitionBlocks('A pool.') ?? [],
      by: { login: 'elle-kzn' },
      from: 270,
      at: AT,
    };
    const held = stored({
      locked: { by: { login: 'elle-kzn' }, at: AT },
      suggestions: [suggestion, suggestion],
    });
    const before = {
      definition: 'Old.',
      blocks: definitionBlocks('Old.') ?? [],
      written: 'agent' as const,
      by: { login: 'elle-kzn' },
      from: 200,
      at: AT,
    };
    const shown = shownOf(term({ stored: held, tag: 'changed', before }), false, 0, REPO);
    expect(shown.marks).toEqual({ mark: 'changed', locked: true, suggestions: 2 });
    expect(shown.before).toEqual(before.blocks);
  });

  it('names who wrote it by name where GitHub matched no account, and no pull request for an edit in Lo', () => {
    const byline = { written: 'human' as const, by: { name: 'Ravi' }, from: 'lo' as const, at: AT };
    const shown = shownOf(term({ byline }), false, Date.parse(AT), REPO);
    expect(shown.byline).toEqual({
      by: { name: 'Ravi' },
      written: 'human',
      pull: undefined,
      when: 'just now',
    });
  });

  it('has no byline for a definition the repo doesn’t hold, and a wait while they’re read', () => {
    expect(shownOf(term({ byline: undefined }), false, 0, REPO).byline).toBeUndefined();
    expect(shownOf(term({ byline: undefined }), true, 0, undefined).byline).toEqual({
      reading: true,
    });
  });
});
