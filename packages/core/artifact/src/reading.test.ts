import MarkdownIt from 'markdown-it';
import { expect, test, vi } from 'vitest';

import { overview } from '../test/support.ts';
import { Findings } from './findings.ts';
import { LIMITS, namedFigures, parseArtifact } from './index.ts';
import { Reading } from './reading.ts';
import type { Read } from './targets.ts';
import type { CodeRange, CodeTarget } from './tree.ts';

/** What `readCode` and `readTerm` were asked to read. */
const asked = vi.hoisted(() => ({ code: [] as string[], term: [] as string[] }));

vi.mock(import('./targets.ts'), async (original) => {
  const targets = await original();
  function readCode(text: string, need: 'range'): Read<CodeRange>;
  function readCode(text: string, need: 'any'): Read<CodeTarget>;
  function readCode(text: string, need: 'range' | 'any'): Read<CodeTarget> {
    asked.code.push(text);
    return need === 'range' ? targets.readCode(text, need) : targets.readCode(text, need);
  }
  const readTerm = (text: string) => {
    asked.term.push(text);
    return targets.readTerm(text);
  };
  return { ...targets, readCode, readTerm };
});

test('each link’s address is read once, however many links name it', () => {
  const code = `${'a'.repeat(1_000)}#L1`;
  const term = 't'.repeat(1_000);
  const uses = '[a][c] [b][t] '.repeat(1_000);
  const parsed = parseArtifact(overview(`[c]: <code:${code}>\n[t]: <term:${term}>\n\n${uses}\n`));
  expect(parsed.references).toHaveLength(LIMITS.targets / 2);
  expect(asked.code.filter((text) => text === code)).toHaveLength(1);
  expect(asked.term.filter((text) => text === term)).toHaveLength(1);
});

test('the tree holds no more of code and terms than the limit on targets lets through', () => {
  const href = `code:${'a'.repeat(1_000)}#L1`;
  const reading = new Reading(new Findings());
  reading.read(new MarkdownIt().parse(`[a](${href})\n`, {}));
  // As if Markdown built that one link over and over.
  let claimed = 0;
  for (let n = 0; n < 2 * LIMITS.targets; n++) if (reading.claim(href)) claimed += 1;
  expect(claimed).toBe(Math.floor((LIMITS.targets * LIMITS.argument) / 1_000));
  // An address the reading didn't keep is never claimed.
  expect(reading.claim('code:b.ts')).toBeUndefined();
});

/** A figure block of `path`, fenced with `colons`. */
function figure(path: string, colons = ':::'): string {
  return `${colons}figure ${path}\nA figure.\n${colons}\n`;
}

test('names the figures first as the parse finds them, without parsing, at most as many as asked', () => {
  const text = overview(
    [
      figure('figures/flow.svg'),
      figure('<figures/a shot.png>'),
      figure('figures/flow.svg'),
      figure('flow.svg'),
      `  ${figure('figures/last.webp', '::::')}`,
    ].join('\n'),
  );
  // Each once, in the order first named; a path that isn't a figure's is none.
  const parsed = [...new Set(parseArtifact(text).figures.map(({ path }) => path))];
  expect(parsed).toEqual(['figures/flow.svg', 'figures/a shot.png', 'figures/last.webp']);
  expect(namedFigures(text, 10)).toEqual(parsed);
  expect(namedFigures(text, 2)).toEqual(parsed.slice(0, 2));
  expect(namedFigures(text.replaceAll('\n', '\r\n'), 10)).toEqual(parsed);
  expect(namedFigures(text, 0)).toEqual([]);
});
