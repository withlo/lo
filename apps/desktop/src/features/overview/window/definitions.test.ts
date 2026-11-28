// Which definition an overview shows for each term, its tags and what a changed one replaces: the
// repository's for every term they hold, the overview's own for what it adds or changes, and its
// own for everything while there are none or Lo can't read them.

import { definitionBlocks, parseArtifact, type ParsedArtifact } from '@lo/artifact';
import { describe, expect, it } from 'vitest';

import type { StoredTerm } from '../jobs.ts';
import { definitionsOf, glossaryOf, sameDefinition, type Subject } from './definitions.ts';
import type { RepoTerms, Terms } from './terms.ts';

const REPO = { owner: 'rozed-dev', name: 'e2e' };

/** An overview of pull request #264 whose glossary holds `items`, each linked from its text. */
function overviewOf(...items: string[]): ParsedArtifact {
  const links = items.map((item) => {
    const name = /^- \*\*(.+?)\*\*/.exec(item)?.[1] ?? '';
    return `[${name}](term:${name.toLowerCase()})`;
  });
  return parseArtifact(
    `---\nformat: 1\npr: 264\ncommit: ${'c'.repeat(40)}\n---\n\n## tl;dr\n\n${links.join(' ')}\n\n## Glossary\n\n${items.join('\n')}\n`,
  );
}

/** A term the repository's definitions hold, written by `from`, with `more`. */
function stored(term: string, definition: string, more: Partial<StoredTerm> = {}): StoredTerm {
  return {
    key: term.toLowerCase(),
    term,
    definition,
    blocks: definitionBlocks(definition) ?? [],
    aliases: [],
    written: 'agent',
    by: { login: 'ravi-k' },
    from: 200,
    at: '2026-11-20T10:00:00Z',
    suggestions: [],
    changes: [],
    ...more,
  };
}

/** The repository's definitions, read, holding `held`. */
function read(...held: StoredTerm[]): RepoTerms {
  const terms: Terms = {
    format: 1,
    terms: new Map(held.map((term) => [term.key, term])),
    names: new Map(
      held.flatMap((term) => [
        [term.key, term.key],
        ...term.aliases.map((alias): [string, string] => [alias.toLowerCase(), term.key]),
      ]),
    ),
  };
  return { kind: 'read', repository: REPO, terms, saved: false, checkedAt: 0, problem: null };
}

const OPEN: Subject = { kind: 'pull', number: 264, state: 'open' };
const MERGED: Subject = { kind: 'pull', number: 264, state: 'merged' };

function shown(parsed: ParsedArtifact, terms: RepoTerms, subject: Subject = OPEN) {
  return definitionsOf(glossaryOf(parsed.tree.blocks), parsed.glossary, terms, subject);
}

/** The text a term shows. */
function textOf(definitions: ReturnType<typeof shown>, key: string): string {
  const blocks = definitions.of(key)?.blocks ?? [];
  return (
    JSON.stringify(blocks)
      .match(/"value":"[^"]*"/g)
      ?.join('') ?? ''
  );
}

describe('which definition shows', () => {
  it("is the repository's for every term they hold, the overview's own for the rest", () => {
    const parsed = overviewOf('- **Bucket**: An old definition.', '- **Tenant**: Whoever pays.');
    const definitions = shown(
      parsed,
      read(stored('Bucket', 'The tokens a tenant has.'), stored('Tenant', 'Whoever pays.')),
      MERGED,
    );
    expect(definitions.of('bucket')).toMatchObject({ source: 'store', tag: undefined });
    expect(textOf(definitions, 'bucket')).toContain('The tokens a tenant has.');
    expect(definitions.of('tenant')).toMatchObject({ source: 'store', tag: undefined });
    expect(definitions.of('bucket')?.own?.name).toBe('Bucket');
    expect(definitions.of('bucket')?.stored?.by).toEqual({ login: 'ravi-k' });
  });

  it("is the overview's own for a term it marks new or changed, merged", () => {
    const parsed = overviewOf(
      '- **Bucket** (changed): The tokens a tenant holds.',
      '- **Quota** (new): How much a tenant may take.',
    );
    const definitions = shown(parsed, read(stored('Bucket', 'The tokens a tenant has.')), MERGED);
    expect(definitions.of('bucket')).toMatchObject({ source: 'overview', tag: 'changed' });
    expect(textOf(definitions, 'bucket')).toContain('holds.');
    expect(definitions.of('quota')).toMatchObject({ source: 'overview', tag: 'new' });
    expect(definitions.added).toBe(1);
    expect(definitions.changed).toBe(1);
  });

  it("is the overview's own for every term while the repository has none, or Lo can't read them", () => {
    const parsed = overviewOf('- **Bucket** (new): The tokens.', '- **Tenant**: Whoever pays.');
    const none: RepoTerms[] = [
      { kind: 'reading' },
      { kind: 'none', repository: REPO, problem: null },
      { kind: 'unreadable', repository: REPO, why: { kind: 'tooMany' } },
    ];
    for (const terms of none) {
      const definitions = shown(parsed, terms);
      expect(definitions.of('bucket')).toMatchObject({
        source: 'overview',
        tag: 'new',
        stored: undefined,
      });
      expect(definitions.of('tenant')).toMatchObject({ source: 'overview', tag: undefined });
      expect(definitions.terms).toBe(terms);
    }
  });

  it("is the repository's for a term the text links that only they hold, else none", () => {
    const parsed = parseArtifact(
      `---\nformat: 1\npr: 264\ncommit: ${'c'.repeat(40)}\n---\n\n## tl;dr\n\nA [quota](term:quota) and a [limit](term:limit).\n`,
    );
    const definitions = shown(parsed, read(stored('Quota', 'How much.')));
    expect(definitions.of('quota')).toMatchObject({
      name: 'Quota',
      source: 'store',
      tag: undefined,
      own: undefined,
    });
    expect(definitions.of('limit')).toBeUndefined();
    expect(definitions.marked).toEqual([]);
    expect(definitions.rest).toEqual([]);
  });

  it('finds a term by one of its aliases', () => {
    const parsed = overviewOf('- **Buckets**: Old words.');
    const definitions = shown(
      parsed,
      read(stored('Bucket', 'The tokens.', { aliases: ['buckets'] })),
      MERGED,
    );
    expect(definitions.of('buckets')).toMatchObject({
      name: 'Buckets',
      source: 'store',
      stored: { key: 'bucket' },
    });
  });

  it('counts a term it changes once, under its name and an alias alike', () => {
    const parsed = overviewOf(
      '- **Bucket** (changed): The tokens a tenant holds.',
      '- **Buckets** (changed): The tokens a tenant holds.',
      '- **Lease** (new): How long.',
    );
    const definitions = shown(
      parsed,
      read(stored('Bucket', 'The tokens.', { aliases: ['buckets'] })),
    );
    expect(definitions.marked.map(({ name }) => name)).toEqual(['Bucket', 'Buckets', 'Lease']);
    expect([definitions.added, definitions.changed]).toEqual([1, 1]);
  });
});

describe('tags', () => {
  it('are only the overview’s marks: an unmarked term is never new or changed', () => {
    const parsed = overviewOf(
      // Unmarked, and not in them: its own, untagged.
      '- **Quota**: How much a tenant may take.',
      // Unmarked, and in them with another definition, as after an edit in Lo: theirs, untagged.
      '- **Tenant**: Whoever   pays.\n  Monthly.',
      // Marked, and not in them, or in them otherwise: its own, as marked.
      '- **Limit** (new): The most a tenant may take.',
      '- **Bucket** (changed): The tokens a tenant holds.',
    );
    const terms = read(stored('Tenant', 'Whoever pays.'), stored('Bucket', 'The tokens.'));
    for (const subject of [OPEN, MERGED, { kind: 'stack' } as const]) {
      const definitions = shown(parsed, terms, subject);
      expect(definitions.of('quota')).toMatchObject({ tag: undefined, source: 'overview' });
      expect(definitions.of('tenant')).toMatchObject({ tag: undefined, source: 'store' });
      expect(textOf(definitions, 'tenant')).toBe('"value":"Whoever pays."');
      expect(definitions.of('limit')).toMatchObject({ tag: 'new', source: 'overview' });
      expect(definitions.of('bucket')).toMatchObject({ tag: 'changed', source: 'overview' });
      expect([definitions.added, definitions.changed]).toEqual([1, 1]);
      expect(definitions.rest.map(({ name }) => name)).toEqual(['Quota', 'Tenant']);
    }
  });

  it('on an open pull request, drop a mark the repository has made moot', () => {
    const parsed = overviewOf(
      // Marked new, and in them since with this definition: theirs.
      '- **Bucket** (new): The tokens a tenant has.',
      // Marked changed, the same but for its spaces: theirs.
      '- **Token** (changed): One   request.',
    );
    const terms = read(
      stored('Bucket', 'The tokens a tenant has.'),
      stored('Token', 'One request.'),
    );
    const draft = { kind: 'pull', number: 264, state: 'draft' } as const;
    for (const subject of [OPEN, draft, { kind: 'stack' } as const]) {
      const definitions = shown(parsed, terms, subject);
      expect(definitions.of('bucket')).toMatchObject({ tag: undefined, source: 'store' });
      expect(definitions.of('token')).toMatchObject({ tag: undefined, source: 'store' });
      expect([definitions.added, definitions.changed]).toEqual([0, 0]);
    }
    // Merged, the merge is what took them: the marks stay.
    const merged = shown(parsed, terms, MERGED);
    expect(merged.of('bucket')).toMatchObject({ tag: 'new', source: 'overview' });
    expect(merged.of('token')).toMatchObject({ tag: 'changed', source: 'overview' });
  });

  it('on an open pull request, follow the repository as it is now: new where it lacks the term, changed where it differs', () => {
    const parsed = overviewOf(
      // Marked changed, and not in them: new.
      '- **Limit** (changed): The most a tenant may take.',
      // Marked new, and in them since with another definition: changed, replacing theirs.
      '- **Bucket** (new): The tokens a tenant holds.',
    );
    const terms = read(stored('Bucket', 'The tokens a tenant has.'));
    for (const subject of [OPEN, { kind: 'stack' } as const]) {
      const definitions = shown(parsed, terms, subject);
      expect(definitions.of('limit')).toMatchObject({ tag: 'new', source: 'overview' });
      expect(definitions.of('bucket')).toMatchObject({ tag: 'changed', source: 'overview' });
      expect(definitions.of('bucket')?.before?.definition).toBe('The tokens a tenant has.');
      expect([definitions.added, definitions.changed]).toEqual([1, 1]);
    }
    // Until they're read, as marked.
    const reading = shown(parsed, { kind: 'reading' });
    expect([reading.of('limit')?.tag, reading.of('bucket')?.tag]).toEqual(['changed', 'new']);
    // Merged, as marked.
    const merged = shown(parsed, terms, MERGED);
    expect([merged.of('limit')?.tag, merged.of('bucket')?.tag]).toEqual(['changed', 'new']);
  });

  it('merged, closed or without them, are as the overview marks them', () => {
    const parsed = overviewOf('- **Bucket** (new): The tokens.', '- **Quota**: How much.');
    const terms = read(stored('Bucket', 'The tokens.'));
    for (const subject of [MERGED, { kind: 'pull', number: 264, state: 'closed' } as const]) {
      const definitions = shown(parsed, terms, subject);
      expect(definitions.of('bucket')?.tag).toBe('new');
      expect(definitions.of('quota')?.tag).toBeUndefined();
    }
  });

  it('list marked terms first, each group by name', () => {
    const parsed = overviewOf(
      '- **zeta** (new): Z.',
      '- **Alpha**: A.',
      '- **beta** (changed): B.',
      '- **Gamma**: G.',
      '- **item10** (new): Ten.',
      '- **item9** (new): Nine.',
    );
    const definitions = shown(parsed, { kind: 'none', repository: REPO, problem: null });
    expect(definitions.marked.map(({ name }) => name)).toEqual(['beta', 'item9', 'item10', 'zeta']);
    expect(definitions.rest.map(({ name }) => name)).toEqual(['Alpha', 'Gamma']);
  });
});

describe('what a changed term replaces', () => {
  const parsed = overviewOf('- **Bucket** (changed): The tokens a tenant holds.');

  it("on an open pull request, is the repository's current definition", () => {
    const definitions = shown(parsed, read(stored('Bucket', 'The tokens a tenant has.')));
    expect(definitions.of('bucket')?.before).toMatchObject({
      definition: 'The tokens a tenant has.',
      written: 'agent',
      by: { login: 'ravi-k' },
      from: 200,
    });
    expect(JSON.stringify(definitions.of('bucket')?.before?.blocks)).toContain('has.');
  });

  it("merged, is the one its merge replaced, from the term's earlier definitions", () => {
    const old = {
      definition: 'Tokens.',
      blocks: definitionBlocks('Tokens.') ?? [],
      written: 'human' as const,
      by: { login: 'elle-kzn' },
      from: 'lo' as const,
      at: '2026-11-01T10:00:00Z',
    };
    const ours = {
      ...old,
      definition: 'The tokens a tenant holds.',
      written: 'agent' as const,
      from: 264,
    };
    // Its merge brought the current one.
    const current = stored('Bucket', 'The tokens a tenant holds.', { from: 264, changes: [old] });
    expect(shown(parsed, read(current), MERGED).of('bucket')?.before).toMatchObject({
      definition: 'Tokens.',
      by: { login: 'elle-kzn' },
    });
    // Edited in Lo since.
    const edited = stored('Bucket', 'Tokens, now.', { from: 'lo', changes: [ours, old] });
    expect(shown(parsed, read(edited), MERGED).of('bucket')?.before?.definition).toBe('Tokens.');
    // A term locked at the merge took a suggestion instead: nothing it replaced.
    const locked = stored('Bucket', 'Tokens.', { changes: [old] });
    expect(shown(parsed, read(locked), MERGED).of('bucket')?.before).toBeUndefined();
    // Nothing older is listed.
    const first = stored('Bucket', 'The tokens a tenant holds.', { from: 264 });
    expect(shown(parsed, read(first), MERGED).of('bucket')?.before).toBeUndefined();
  });

  it('is nothing without the repository’s definitions', () => {
    expect(
      shown(parsed, { kind: 'none', repository: REPO, problem: null }).of('bucket')?.before,
    ).toBeUndefined();
  });
});

describe('who a definition is by', () => {
  const byline = {
    written: 'agent',
    by: { login: 'ravi-k' },
    from: 200,
    at: '2026-11-20T10:00:00Z',
  };

  it("is the repository's entry's, where its definition shows", () => {
    const parsed = overviewOf('- **Bucket**: Tokens.', '- **Quota**: How much.');
    const definitions = shown(parsed, read(stored('Bucket', 'The tokens a tenant has.')));
    expect(definitions.of('bucket')?.byline).toEqual(byline);
    // A term they don't hold has none.
    expect(definitions.of('quota')?.byline).toBeUndefined();
    // Nor does any term while they can't be read.
    const none = shown(parsed, { kind: 'none', repository: REPO, problem: null });
    expect(none.of('bucket')?.byline).toBeUndefined();
  });

  it('is of the definition a changed term replaces on a pull request that didn’t merge', () => {
    const parsed = overviewOf('- **Bucket** (changed): The tokens a tenant holds.');
    const terms = read(stored('Bucket', 'The tokens a tenant has.'));
    expect(shown(parsed, terms).of('bucket')?.byline).toEqual(byline);
    // Closed without merging, the repository's definition is still the one it replaces.
    const closed = { kind: 'pull', number: 264, state: 'closed' } as const;
    expect(shown(parsed, terms, closed).of('bucket')).toMatchObject({
      tag: 'changed',
      before: { definition: 'The tokens a tenant has.' },
      byline,
    });
    // A term it marks new that they hold shows its own, and so names no one.
    const added = overviewOf('- **Bucket** (new): The tokens a tenant holds.');
    expect(shown(added, terms, closed).of('bucket')?.byline).toBeUndefined();
  });

  it("merged, is the merge's own entry's while nothing has changed it since", () => {
    const parsed = overviewOf('- **Bucket** (changed): The tokens a tenant holds.');
    const ours = stored('Bucket', 'The tokens a tenant holds.', { from: 264 });
    expect(shown(parsed, read(ours), MERGED).of('bucket')?.byline).toMatchObject({ from: 264 });
    // Edited in Lo since, or locked at the merge: who wrote a definition nothing here shows.
    const edited = stored('Bucket', 'Tokens, now.', { from: 'lo', written: 'human' });
    expect(shown(parsed, read(edited), MERGED).of('bucket')?.byline).toBeUndefined();
  });
});

describe('two definitions', () => {
  it('are the same but for the runs of spaces in them', () => {
    expect(sameDefinition('One  request.', ' One request. ')).toBe(true);
    expect(sameDefinition('One request.', 'One request')).toBe(false);
  });
});
