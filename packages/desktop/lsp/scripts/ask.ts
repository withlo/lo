// What the live check asks a server, at places in the sample projects: what `gd`, `gr`, `K`, `gh`
// and `gO` ask (a definition, references, a hover, the file's inlay hints and its outline), printing
// what came back, in short.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type Answer, type Server, type ServerSpec, startServer } from '../src/index.ts';

/** A place to ask about: a file of the checkout, by its path there, and a place in it. */
export interface Place {
  readonly file: string;
  readonly languageId: string;
  readonly position: { readonly line: number; readonly character: number };
}

/** What a server's check asks: each place, on the checkout `spec.root`. */
export interface Ask {
  readonly spec: ServerSpec;
  readonly places: readonly Place[];
}

/** How long a server has to answer, and to finish indexing before it's asked. */
const DEADLINE = 120_000;

/**
 * Starts `ask.spec`, opens each place's file, waits for it to finish indexing, asks each place what
 * Lo asks, prints the answers, and stops it. It returns the server's log.
 */
export async function askServer(ask: Ask): Promise<readonly string[]> {
  const server = startServer(ask.spec);
  try {
    if (!(await server.ready)) {
      throw new Error(`${ask.spec.name} didn't start (${server.state.kind})`);
    }
    const texts = new Map<string, string>();
    for (const place of ask.places) {
      const text = await readFile(join(ask.spec.root, ...place.file.split('/')), 'utf8');
      texts.set(place.file, text);
      server.open(place.file, place.languageId, text);
    }
    await settled(server);
    const options = { deadline: DEADLINE };
    for (const { file, position } of ask.places) {
      console.log(`\n${file}:${position.line + 1}:${position.character + 1}`);
      const at = { path: file, position };
      const definition = await server.request('textDocument/definition', at, options);
      console.log(`  gd ${said(definition, (value) => places(server, value))}`);
      const references = await server.request(
        'textDocument/references',
        { ...at, context: { includeDeclaration: true } },
        options,
      );
      console.log(`  gr ${said(references, (value) => places(server, value))}`);
      const hover = await server.request('textDocument/hover', at, options);
      console.log(`  K  ${said(hover, hoverText)}`);
      const lines = (texts.get(file) ?? '').split('\n').length;
      const range = { start: { line: 0, character: 0 }, end: { line: lines, character: 0 } };
      const hints = await server.request('textDocument/inlayHint', { path: file, range }, options);
      console.log(`  gh ${said(hints, hintsOf)}`);
      const symbols = await server.request('textDocument/documentSymbol', { path: file }, options);
      console.log(`  gO ${said(symbols, symbolsOf)}`);
    }
  } finally {
    await server.stop();
    const log = server.log.slice(-30);
    if (log.length > 0) console.log(`\nThe last of its log:\n${log.join('\n')}`);
  }
  return server.log;
}

/** Resolves once `server` has been out of `indexing` for a second, or after the deadline. */
async function settled(server: Server): Promise<void> {
  const until = performance.now() + DEADLINE;
  let quiet = 0;
  while (quiet < 1000 && performance.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    quiet = server.state.kind === 'indexing' ? 0 : quiet + 100;
  }
}

/** An answer, as `read` puts its value, or why there's none. */
function said(answer: Answer, read: (value: unknown) => string): string {
  if (!answer.ok) {
    return `no answer (${answer.why}${answer.message === undefined ? '' : `: ${answer.message}`})`;
  }
  return answer.value === null ? 'null' : read(answer.value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Where a location or a location link points: its file and the start of its range, from 1. */
function placeOf(server: Server, value: unknown): string {
  if (!isObject(value)) return '?';
  const uri = value.targetUri ?? value.uri;
  const range = value.targetSelectionRange ?? value.range;
  const start = isObject(range) && isObject(range.start) ? range.start : {};
  const path = typeof uri === 'string' ? server.pathOf(uri) : undefined;
  const where = path ?? `outside the checkout, ${String(uri)}`;
  return `${where}:${Number(start.line) + 1}:${Number(start.character) + 1}`;
}

/** A definition's or references' places, the first 10 of them. */
function places(server: Server, value: unknown): string {
  const all: unknown[] = Array.isArray(value) ? value : [value];
  const shown = all.slice(0, 10).map((each) => placeOf(server, each));
  return `${all.length} ${all.length === 1 ? 'place' : 'places'}: ${shown.join(', ')}`;
}

/** A hover's text, on one line. */
function hoverText(value: unknown): string {
  const contents = isObject(value) ? value.contents : undefined;
  const parts: unknown[] = Array.isArray(contents) ? contents : [contents];
  const text = parts
    .map((part) => (typeof part === 'string' ? part : isObject(part) ? String(part.value) : ''))
    .join(' ');
  return JSON.stringify(text.replace(/\s+/g, ' ').trim().slice(0, 240));
}

/** Inlay hints' count, and the first 8, each where it goes, from 1, and what it says. */
function hintsOf(value: unknown): string {
  const all: unknown[] = Array.isArray(value) ? value : [];
  const shown = all.slice(0, 8).map((hint) => {
    if (!isObject(hint) || !isObject(hint.position)) return '?';
    const label: unknown = hint.label;
    const text = Array.isArray(label)
      ? label.map((part: unknown) => (isObject(part) ? String(part.value) : '')).join('')
      : String(label);
    const { line, character } = hint.position;
    return `${Number(line) + 1}:${Number(character) + 1} ${JSON.stringify(text)}`;
  });
  return `${all.length} hints${shown.length > 0 ? `: ${shown.join(', ')}` : ''}`;
}

/** An outline's count of symbols at its top level, and their names. */
function symbolsOf(value: unknown): string {
  const all: unknown[] = Array.isArray(value) ? value : [];
  const names = all.map((symbol) => (isObject(symbol) ? String(symbol.name) : '?'));
  return `${all.length} at the top: ${names.join(', ')}`;
}
