import { describe, expect, test } from 'vitest';

import { overview, PREAMBLE_LINES } from '../test/support.ts';
import { overviewFiles, repository } from '../test/readers.ts';
import {
  checkArtifact,
  parseArtifact,
  parseStore,
  STORE_LIMITS,
  type CheckedArtifact,
  type GlossaryEntry,
} from './index.ts';

const LINE = PREAMBLE_LINES + 1;
const COMMIT = '3f9c2e1d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e';

/** An overview of `items`, a glossary, after a line that links each term, so none is unused. */
function text(items: readonly string[]): string {
  const links = items.flatMap((item) => {
    const term = /^- (?:\*\*|__)(.*?)(?:\*\*|__)/.exec(item)?.[1];
    return term === undefined ? [] : [`[x](<term:${term.replaceAll('\\', '')}>)`];
  });
  return overview(`${links.join(' ')}\n\n## Glossary\n\n${items.join('\n')}\n`);
}

function glossary(...items: string[]): GlossaryEntry[] {
  return parseArtifact(text(items)).glossary;
}

/** Why the repository's definitions can't hold `item`'s definition. */
function whyNot(item: string): string | undefined {
  return glossary(item)[0]!.unstorable;
}

/** The entries' definitions, as written. */
function written(...items: string[]): (string | undefined)[] {
  return glossary(...items).map(({ definition }) => definition);
}

describe('a glossary entry', () => {
  test('keeps its term, its mark, its line and its definition as written', () => {
    expect(
      glossary(
        '- **Bucket** (new): the tokens a [tenant](term:tenant) has, *spent* in `take()`.',
        '- **Tenant**: whoever',
        '  pays, and their    keys.',
        '- **Token** (changed): one request.',
      ),
    ).toEqual([
      {
        name: 'Bucket',
        key: 'bucket',
        mark: 'new',
        line: LINE + 4,
        definition: 'the tokens a [tenant](term:tenant) has, *spent* in `take()`.',
        unstorable: 'holds emphasis',
      },
      {
        name: 'Tenant',
        key: 'tenant',
        line: LINE + 5,
        definition: 'whoever pays, and their    keys.',
      },
      { name: 'Token', key: 'token', mark: 'changed', line: LINE + 7, definition: 'one request.' },
    ]);
  });

  test('starts its definition where its term ends', () => {
    expect(
      written(
        '- __Under__: underscores.',
        '- **`a**:b`**: a colon in code.',
        '- **a\\*\\*: b**: escaped stars.',
        '- **a.**: b**: c.',
        '- **`x`** (new): code alone.',
        '- **&amp;**: an entity.',
      ),
    ).toEqual([
      'underscores.',
      'a colon in code.',
      'escaped stars.',
      'b**: c.',
      'code alone.',
      'an entity.',
    ]);
    expect(glossary('- **a\\*\\*: b**: x.', '- **a.**: b**: c.').map(({ name }) => name)).toEqual([
      'a**: b',
      'a.',
    ]);
  });

  test('that is more than one paragraph has no definition as written', () => {
    expect(
      glossary('- **Bucket** (new): the tokens.', '', '  And more.', '- **Map**: a map.').map(
        ({ definition, unstorable }) => [definition, unstorable],
      ),
    ).toEqual([
      [undefined, 'is more than one paragraph'],
      ['a map.', undefined],
    ]);
    expect(written('- **Bucket**: one.', '  - nested')).toEqual([undefined]);
  });

  test('may go into the repository’s definitions when they’d read it as the overview does', () => {
    expect(whyNot('- **A**: text, `code`, [code](code:src/a.ts#L1) and [b](term:a).')).toBe(
      undefined,
    );
    expect(whyNot('- **A**: per_request, a < b, ~5 ms.')).toBe(undefined);
    expect(whyNot('- **A**: **strong**.')).toBe('holds bold text');
    expect(whyNot('- **A**: [out](https://example.com).')).toBe(
      "holds a link that isn't to code or a term",
    );
    expect(whyNot('- **A**: ![image](figures/a.png).')).toBe('holds an image');
    expect(whyNot('- **A**: <b>html</b>.')).toBe('holds HTML');
    expect(whyNot('- **A**: a hard\\\n  break.')).toBe('holds a hard line break');
    const most = `- **A**: ${'a'.repeat(STORE_LIMITS.definition)}`;
    expect(whyNot(most)).toBe(undefined);
    expect(whyNot(`${most}a`)).toBe('is 2,049 bytes');
  });

  test('whose definition is storable reads as storable from the store', () => {
    for (const item of [
      '- **A**: text, `code`, [code](code:src/a.ts#L1) and [b](term:a).',
      '- **A**: per_request, a < b, ~5 ms, \\*no emphasis\\*.',
      '- **A**: on two\n  lines.',
    ]) {
      const [entry] = glossary(...item.split('\n'));
      expect(entry?.unstorable).toBe(undefined);
      const read = parseStore(
        JSON.stringify({
          format: 1,
          terms: {
            a: {
              term: entry!.name,
              definition: entry!.definition,
              written: 'agent',
              by: { login: 'octocat' },
              from: '#4797',
              at: '2026-11-27T10:30:00Z',
            },
          },
        }),
      );
      expect({ item, ok: read.ok }).toEqual({ item, ok: true });
    }
  });

  test('is read in time on a paragraph of would-be ends', () => {
    const start = performance.now();
    const entries = glossary(`- **a ${'**: '.repeat(20_000)}**: x.`);
    expect(entries.length).toBeLessThanOrEqual(1);
    // A term whose colon is an escape, so no end of its bold is followed by it.
    const escaped = glossary(`- **Bucket**\\: ${'x **: '.repeat(20_000)}`);
    expect(escaped.map(({ name, definition }) => [name, definition])).toEqual([
      ['Bucket', undefined],
    ]);
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});

/** `items`, a glossary, checked. */
async function check(...items: string[]): Promise<CheckedArtifact> {
  const overviewText = text(items);
  const files = overviewFiles({ 'artifact.md': overviewText });
  return checkArtifact(parseArtifact(overviewText), files, repository(COMMIT, {}).readCode, {
    pr: 4797,
  });
}

describe('a marked term', () => {
  test('whose definition the repository’s definitions can’t hold fails, and still shows', async () => {
    const checked = await check(
      '- **Bucket** (changed): The *tokens*.',
      '- **Token** (new): One request.',
      '',
      '  More.',
      `- **Map** (new): ${'a'.repeat(STORE_LIMITS.definition + 1)}`,
      '- **Tenant**: Not *marked*, so it may.',
    );
    expect(checked.findings.map(({ code, line }) => `${code}@${line ?? ''}`)).toEqual([
      `mark-definition@${LINE + 4}`,
      `mark-definition@${LINE + 5}`,
      `mark-definition@${LINE + 8}`,
    ]);
    expect(checked.outcome.kind).toBe('shown');
    expect(checked.findings[0]?.message).toBe(
      '"Bucket" is marked (changed), so its definition goes into the repository\'s definitions, and it holds emphasis. They hold one paragraph of text, inline code and links to code and terms, in at most 2,048 bytes: write it so, or take the mark off.',
    );
    expect(checked.findings[1]?.message).toContain('and it is more than one paragraph.');
    expect(checked.findings[2]?.message).toContain('and it is 2,049 bytes.');
  });
});
