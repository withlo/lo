// Whether the repo's glossary holds a term, so its row expands and its history shows, or why not.

import { definitionBlocks, parseArtifact } from '@lo/artifact';
import { describe, expect, it } from 'vitest';

import type { StoredTerm } from '../jobs.ts';
import { definitionsOf, glossaryOf, type Subject } from './definitions.ts';
import {
  GLOSSARY_READING,
  joinsGlossary,
  NO_GLOSSARY,
  NOT_IN_GLOSSARY,
  STORE_TITLE,
} from './says.ts';
import { heldBy } from './termRows.ts';
import type { RepoTerms } from './terms.ts';

const REPO = { owner: 'rozed-dev', name: 'e2e' };

/** An overview of pull request #264 that adds Bucket and defines Credit, unmarked. */
const PARSED = parseArtifact(
  `---\nformat: 1\npr: 264\ncommit: ${'c'.repeat(40)}\n---\n\n## tl;dr\n\n[Bucket](term:bucket) [Credit](term:credit)\n\n## Glossary\n\n- **Bucket** (new): The tokens a tenant has.\n- **Credit**: What a request spends.\n`,
);

const CREDIT: StoredTerm = {
  key: 'credit',
  term: 'Credit',
  definition: 'What a request spends.',
  blocks: definitionBlocks('What a request spends.') ?? [],
  aliases: [],
  written: 'agent',
  by: { login: 'ravi-k' },
  from: 200,
  at: '2026-11-20T10:00:00Z',
  suggestions: [],
  changes: [],
};

/** The repo's definitions, read, holding Credit. */
const READ: RepoTerms = {
  kind: 'read',
  repository: REPO,
  terms: {
    format: 1,
    terms: new Map([['credit', CREDIT]]),
    names: new Map([['credit', 'credit']]),
  },
  saved: false,
  checkedAt: 0,
  problem: null,
};

/** Whether the glossary holds the term `key` names, with `terms`, in an overview of `subject`. */
function held(key: string, terms: RepoTerms, subject: Subject): true | string {
  const definitions = definitionsOf(
    glossaryOf(PARSED.tree.blocks),
    PARSED.glossary,
    terms,
    subject,
  );
  const term = definitions.of(key);
  if (!term) throw new Error(`The overview doesn’t define ${key}.`);
  return heldBy(definitions, term);
}

const OPEN: Subject = { kind: 'pull', number: 264, state: 'open' };

describe('what the repo’s glossary holds of a term', () => {
  it('holds a term it has', () => {
    expect(held('credit', READ, OPEN)).toBe(true);
  });

  it('says a term an open pull request adds joins it as it merges, and otherwise isn’t in it', () => {
    expect(held('bucket', READ, OPEN)).toBe(joinsGlossary(264));
    expect(held('bucket', READ, { kind: 'pull', number: 264, state: 'draft' })).toBe(
      joinsGlossary(264),
    );
    expect(held('bucket', READ, { kind: 'pull', number: 264, state: 'merged' })).toBe(
      NOT_IN_GLOSSARY,
    );
    expect(held('bucket', READ, { kind: 'stack' })).toBe(NOT_IN_GLOSSARY);
  });

  it('says why while it’s read, missing, or can’t be read', () => {
    expect(held('credit', { kind: 'reading' }, OPEN)).toBe(GLOSSARY_READING);
    expect(held('credit', { kind: 'none', repository: REPO, problem: null }, OPEN)).toBe(
      NO_GLOSSARY,
    );
    expect(
      held('credit', { kind: 'unreadable', repository: REPO, why: { kind: 'tooMany' } }, OPEN),
    ).toBe(STORE_TITLE);
  });
});
