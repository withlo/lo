// What the live check asks a server, at places in the sample projects: what `gd`, `gr`, `K`, `gh`
// and `gO` ask (a definition, references, a hover, the file's inlay hints and its outline), printing
// what came back, in short.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  type Answer,
  readFamily,
  type Server,
  type ServerSpec,
  startServer,
} from '../src/index.ts';

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
  /** Files whose outline it's asked for besides the places', by their paths in the checkout. */
  readonly outlines?: readonly Omit<Place, 'position'>[] | undefined;
}

/** How long a server has to answer, and to finish indexing before it's asked. */
const DEADLINE = 120_000;

/** What a server did besides answer, as {@link askServer} watched it. */
export interface Watched {
  /** Its log. */
  readonly log: readonly string[];
  /** Each program its processes ran as, by name. */
  readonly programs: readonly string[];
  /** Each internet connection or socket any of them held, as `lsof` lists it. */
  readonly connections: readonly string[];
}

/**
 * Starts `ask.spec`, opens each place's file, waits for it to finish indexing, asks each place what
 * Lo asks, prints the answers, how long it took to start and what memory it held, and stops it. As
 * it runs, it reads what programs the server's processes are and what internet sockets they hold,
 * every half second. It returns those, and the server's log.
 */
export async function askServer(ask: Ask): Promise<Watched> {
  const started = performance.now();
  const server = startServer(ask.spec);
  const programs = new Set<string>();
  const connections = new Set<string>();
  const done = new AbortController();
  const watched = (async () => {
    while (!done.signal.aborted) {
      await watch(server, programs, connections);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  })();
  try {
    if (!(await server.ready)) {
      throw new Error(`${ask.spec.name} didn't start (${server.state.kind})`);
    }
    console.log(`It answered initialize ${seconds(performance.now() - started)} after it started.`);
    const texts = new Map<string, string>();
    for (const { file, languageId } of [...ask.places, ...(ask.outlines ?? [])]) {
      if (texts.has(file)) continue;
      const text = await readFile(join(ask.spec.root, ...file.split('/')), 'utf8');
      texts.set(file, text);
      server.open(file, languageId, text);
    }
    const indexed = await settled(server);
    console.log(`It was done indexing ${seconds(indexed - started)} after it started.`);
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
      // The whole file, to the end of its last line: JDT LS answers nothing past it.
      const lines = (texts.get(file) ?? '').split('\n');
      const end = { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
      const range = { start: { line: 0, character: 0 }, end };
      const hints = await server.request('textDocument/inlayHint', { path: file, range }, options);
      console.log(`  gh ${said(hints, hintsOf)}`);
      const symbols = await server.request('textDocument/documentSymbol', { path: file }, options);
      console.log(`  gO ${said(symbols, symbolsOf)}`);
    }
    for (const { file } of ask.outlines ?? []) {
      console.log(`\n${file}`);
      const symbols = await server.request('textDocument/documentSymbol', { path: file }, options);
      console.log(`  gO ${said(symbols, symbolsOf)}`);
    }
    const memory = await held(server);
    const amount = memory === undefined ? 'an unread amount of' : megabytes(memory);
    console.log(`\nIts processes held ${amount} memory then.`);
  } finally {
    await watch(server, programs, connections);
    done.abort();
    await watched;
    await server.stop();
    const log = server.log.slice(-30);
    if (log.length > 0) console.log(`\nThe last of its log:\n${log.join('\n')}`);
  }
  return { log: server.log, programs: [...programs].toSorted(), connections: [...connections] };
}

const run = promisify(execFile);

/**
 * Adds what `server`'s processes run as to `programs`, and the internet sockets they hold to
 * `connections`, as `ps` and `lsof` say now. A read that fails adds nothing.
 */
async function watch(server: Server, programs: Set<string>, connections: Set<string>) {
  const group = server.pid;
  if (group === undefined) return;
  const family = await readFamily(group).catch(() => []);
  const pids = family.map((member) => String(member.pid)).join(',');
  if (pids === '') return;
  const env = { PATH: '/usr/sbin:/usr/bin:/bin:/sbin' };
  const listed = await run('ps', ['-o', 'comm=', '-p', pids], { env }).catch(() => undefined);
  for (const line of listed?.stdout.split('\n') ?? []) {
    if (line.trim() !== '') programs.add(line.trim());
  }
  // `lsof` exits 1 when it finds nothing, which is what it should find.
  const open = await run('lsof', ['-nP', '-a', '-i', '-p', pids], { env }).catch(
    (error: unknown) => (error instanceof Error && 'stdout' in error ? error : undefined),
  );
  const lines = typeof open?.stdout === 'string' ? open.stdout.split('\n') : [];
  for (const line of lines.slice(1)) {
    if (line.trim() !== '') connections.add(line.trim());
  }
}

/**
 * Resolves once `server` has been out of `indexing` for a second, or after the deadline, with when
 * it was last seen indexing, or when it began to be watched if it never was.
 */
async function settled(server: Server): Promise<number> {
  const until = performance.now() + DEADLINE;
  let last = performance.now();
  let quiet = 0;
  while (quiet < 1000 && performance.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (server.state.kind === 'indexing') {
      last = performance.now();
      quiet = 0;
    } else {
      quiet += 100;
    }
  }
  return last;
}

/** The resident memory of `server`'s processes, once Lo has read it, within 6 s. */
async function held(server: Server): Promise<number | undefined> {
  const until = performance.now() + 6000;
  while (server.memory === undefined && performance.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return server.memory;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 ** 2)} MB`;
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

/** An outline's count of symbols at its top level, and their names, each with what's inside it. */
function symbolsOf(value: unknown): string {
  const all: unknown[] = Array.isArray(value) ? value : [];
  const named = (symbol: unknown): string => {
    if (!isObject(symbol)) return '?';
    const inside: unknown[] = Array.isArray(symbol.children) ? symbol.children : [];
    const children = inside.length > 0 ? ` (${inside.map(named).join(', ')})` : '';
    return `${String(symbol.name)}${children}`;
  };
  return `${all.length} at the top: ${all.map(named).join(', ')}`;
}
