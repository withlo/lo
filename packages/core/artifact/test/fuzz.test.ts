/**
 * Random mixes of the format's pieces, Markdown's and odd characters: whatever they make, the
 * parse never throws, its tree passes the walker, an overview without errors passes it in full,
 * and every finding is one the format defines, quoted harmlessly.
 */

import { expect, test } from 'vitest';

import {
  ARTIFACT,
  isFindingCode,
  LIMITS,
  parseArtifact,
  severityOf,
  type ParsedArtifact,
} from '../src/index.ts';
import { HEADER } from './support.ts';
import { isPlainPath, problems } from './walker.ts';

/** A small, seeded generator, so a failure names the mix that made it. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const STARTS = [
  `${HEADER}\n`,
  `\uFEFF${HEADER.replaceAll('\n', '\r\n')}`,
  '---\nformat: 1\npr: 1\n---\n',
  '---\nformat: 2\n---\n',
  '---\nformat: 01\npr: x\ncommit: -y\nother: z\n---\n',
  '---\nformat: 1\n',
  '',
];

const PIECES = [
  '## tl;dr\n',
  '## TL;DR\n',
  '## Glossary\n',
  '## How it works\n',
  '# Title\n',
  '### Sub\n',
  'Text.\n',
  'More text ',
  '\n',
  '\n\n',
  '- **Term**: a definition.\n',
  '- **term**: again.\n',
  '- **Hash  map**:\n  on the next line.\n',
  '- **__proto__**: odd.\n',
  '- not a term\n',
  ':::code src/a.ts#L1-L3\n',
  ':::code src/a.ts\n',
  ':::code ../x#L1\n',
  ':::figure figures/a.svg\n',
  ':::figure a.svg\n',
  ':::walkthrough W\n',
  ':::step src/a.ts#L2\n',
  ':::tabs\n',
  ':::tab T\n',
  ':::fold F\n',
  ':::chart\n',
  ':::\n',
  '::::::\n',
  '  :::\n',
  '- [part](#tldr)\n',
  '- [part](code:a.ts)\n',
  '- [1x](term:term)\n',
  '[l](code:src/a.ts#L1)',
  '[w](code:src/a.ts)',
  '[t](term:term)',
  '[p](term:__proto__)',
  '[c](term:constructor)',
  '[g](code:.git/config)',
  '[z](code:a.ts#L0)',
  '[s](#tldr)',
  '[d](#nowhere)',
  '[j](javascript:alert(1))',
  '[r](relative/path)',
  '<code:a.ts#L1>',
  '[ref][r]\n\n[r]: code:b.ts\n',
  '![i](https://camo.githubusercontent.com/a)',
  '![o](https://example.com/o.png)',
  '> ',
  '- ',
  '1. ',
  '  ',
  '    ',
  '```\n',
  '~~~\n',
  '`',
  '**',
  '_',
  '*',
  '~~',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '\\',
  '|a|b|\n|-|-|\n|c|d|\n',
  '[^1]',
  '[^1]: A note.\n',
  '> [!NOTE]\n> Noted.\n',
  '<div>\n',
  '<!-- c -->',
  '&amp;',
  '&#0;',
  '&#x1b;',
  '@octocat ',
  'www.example.com ',
  '---\n',
  '===\n',
  '\r\n',
  '\r',
  '\t',
  '\0',
  '\x1b[31m',
  '\u202E',
  '\u2028',
  '\u200B',
  '\uFEFF',
  '\u0301',
  '🧪',
  'é',
  '#L',
  '-L',
  'figures/',
];

/** Pieces no UTF-8 holds, so a mix with one is refused whole: they're added rarely. */
const UNPAIRED = ['\ud800', '\udc00'];

/** A random overview from `seed`: a start, then up to 300 pieces. */
function mix(seed: number): string | Uint8Array {
  const next = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  let text = pick(STARTS);
  const count = Math.floor(next() * 300);
  for (let i = 0; i < count; i++) text += next() < 0.0002 ? pick(UNPAIRED) : pick(PIECES);
  if (next() < 0.8) return text;
  // As bytes, some of them changed: to anything, or to an ASCII byte, which keeps it UTF-8.
  const bytes = new TextEncoder().encode(text);
  const any = next() < 0.5;
  for (let i = 0; i < 8 && bytes.length > 0; i++) {
    bytes[Math.floor(next() * bytes.length)] = Math.floor(next() * (any ? 256 : 128));
  }
  return bytes;
}

/** Everything wrong with `parsed`, read from any input. */
function wrong(parsed: ParsedArtifact): string[] {
  const found: string[] = [];
  const errors = parsed.findings.filter(({ severity }) => severity === 'error');
  found.push(...problems(parsed.tree, { counts: errors.length === 0 }));
  if (parsed.findings.length > LIMITS.findings) found.push('too many findings');
  for (const finding of parsed.findings) {
    const { code, severity, file, line, message } = finding;
    if (!isFindingCode(code) || severityOf(code) !== severity) found.push(`the code ${code}`);
    if (code === 'unreadable') found.push('unreadable');
    if (file !== ARTIFACT) found.push(`the file ${file}`);
    if (line !== undefined && !(Number.isSafeInteger(line) && line >= 1))
      found.push(`line ${String(line)}`);
    if (message === '' || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(message)) found.push(message);
  }
  for (const { target, line, from } of parsed.references) {
    if (!isPlainPath(target.path)) found.push(`the reference ${String(target.path)}`);
    if (!(line >= 1) || !['block', 'step', 'link'].includes(from)) found.push(`${from}@${line}`);
  }
  return found;
}

test('300 random mixes never throw, and hold only what the format allows', () => {
  let clean = 0;
  let shown = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const input = mix(seed);
    const parsed = parseArtifact(input);
    expect(wrong(parsed), `mix ${seed}`).toEqual([]);
    if (parsed.findings.length === 0) clean += 1;
    if (parsed.tree.blocks.length > 0) shown += 1;
    // Bytes and text read alike.
    const same = typeof input === 'string' && input.isWellFormed();
    const again = same ? parseArtifact(new TextEncoder().encode(input)) : parsed;
    expect(again, `mix ${seed}`).toEqual(parsed);
  }
  // The mixes reach past the header: most are read as text, though few are clean.
  expect(shown).toBeGreaterThan(150);
  expect(clean).toBeLessThan(300);
});

/** A random overview from `seed` that keeps to every rule: sections, blocks, links and terms. */
function valid(seed: number): string {
  const next = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const terms = ['bucket', 'Hash map', 'token'];
  const used = new Set<string>();
  const line = (): number => 1 + Math.floor(next() * 500);
  const range = (): string => {
    const start = line();
    return `src/${pick(['a.ts', 'b/c.ts', 'read me.md'])}#L${start}-L${start + Math.floor(next() * 200)}`;
  };
  const prose = (): string => {
    const words: string[] = [];
    for (let i = 0; i < 1 + next() * 6; i++) {
      const term = pick(terms);
      const choice = Math.floor(next() * 6);
      if (choice === 0) words.push(`[code](<code:${range()}>)`);
      else if (choice === 1) words.push(`[file](code:src/a.ts)`);
      else if (choice === 2) {
        used.add(term);
        words.push(`[${term}](<term:${term.toUpperCase()}>)`);
      } else if (choice === 3) words.push('[up](#tldr)');
      else words.push(pick(['Some *text*', 'with `code`', 'and **more**', 'here.']));
    }
    return `${words.join(' ')}\n`;
  };
  /** A block inside `depth` others: blocks nest at most 4 deep, a step or tab 2 below its own. */
  const block = (depth: number): string => {
    const kinds = ['prose'];
    if (depth <= 3) kinds.push('code', 'figure', 'fold');
    if (depth <= 2) kinds.push('walkthrough', 'tabs');
    switch (pick(kinds)) {
      case 'code':
        return `:::code <${range()}>\n:::\n`;
      case 'figure': {
        // Only an SVG has parts.
        const type = pick(['svg', 'png', 'webp']);
        const parts = Array.from(
          { length: type === 'svg' ? Math.floor(next() * 3) : 0 },
          (_, n) => `- [p${n}](#tldr)\n`,
        );
        return `:::figure figures/f${line()}.${type}\n${prose()}\n${parts.join('')}:::\n`;
      }
      case 'walkthrough': {
        const steps = Array.from(
          { length: 3 + Math.floor(next() * 4) },
          () => `:::step <${range()}>\n${prose()}:::\n`,
        );
        return `:::walkthrough Steps\n${steps.join('')}:::\n`;
      }
      case 'tabs': {
        const tabs = Array.from(
          { length: 2 + Math.floor(next() * 3) },
          (_, n) => `:::tab Tab ${n}\n${block(depth + 2)}:::\n`,
        );
        return `:::tabs\n${tabs.join('')}:::\n`;
      }
      case 'fold':
        return `:::fold More\n${block(depth + 1)}:::\n`;
      default:
        return `${prose()}\n- ${prose()}\n`;
    }
  };
  let text = `${HEADER}\n## tl;dr\n\n${prose()}\n`;
  for (let section = 0; section < 1 + next() * 4; section++) {
    text += `## Section ${section}\n\n`;
    for (let i = 0; i < 1 + next() * 4; i++) text += `${block(0)}\n`;
  }
  if (used.size > 0) {
    text += '## Glossary\n\n';
    for (const term of used) text += `- **${term}**: what ${term} means.\n`;
  }
  return text;
}

test('300 random overviews that keep to the rules read clean', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const parsed = parseArtifact(valid(seed));
    expect(parsed.findings, `overview ${seed}`).toEqual([]);
    expect(problems(parsed.tree, { counts: true }), `overview ${seed}`).toEqual([]);
  }
});
