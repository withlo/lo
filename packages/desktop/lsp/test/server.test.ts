// The server's life against the fake language server: starting, the protocol both ways, its
// requests and their deadlines, crashes, hangs, memory and stops. Each test starts one fake server,
// which is killed with its group when the test ends.

import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, onTestFinished, test, vi } from 'vitest';

import {
  failureMessage,
  LIMITS,
  OPEN_LIMIT,
  readFamily,
  type RequestOptions,
  type Server,
  type State,
  startServer,
} from '../src/index.ts';
import { longestStop } from '../src/server.ts';
import { fakeServer } from '@lo/testing/lsp';

import { eventually, GIT, running, startFake, tempFolder } from './support.ts';

const POSITION = { position: { line: 0, character: 6 } };

/** A notification, framed as a server sends it: what a flood of valid messages repeats. */
const NOTIFICATION = (() => {
  const body = JSON.stringify({ jsonrpc: '2.0', method: 'x/flood' });
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
})();

/**
 * Starts watching how late a 10 ms timer runs, and returns what stops it and says the latest it
 * ran, in milliseconds: how long main's loop was kept from its turns.
 */
function watchLag(): () => number {
  let worst = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last - 10);
    last = now;
  }, 10);
  return () => {
    clearInterval(timer);
    return worst;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Asks `server` for the hover on `src/a.ts`. */
function hover(server: Server, options: RequestOptions = { deadline: 5000 }) {
  return server.request('textDocument/hover', { path: 'src/a.ts', ...POSITION }, options);
}

/** What a started process's environment holds, read from outside it as the system reports it. */
function environmentOf(pid: number): { text: string; names?: string[] } {
  if (existsSync(`/proc/${pid}/environ`)) {
    const variables = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    const names = variables.filter((line) => line !== '').map((line) => line.split('=')[0] ?? '');
    return { text: variables.join('\n'), names };
  }
  return {
    text: execFileSync('ps', ['eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }),
  };
}

test('it starts with Lo’s capabilities, and answers about the files Lo opened', async () => {
  const { server, root, seen } = startFake({
    answers: {
      'textDocument/hover': { 'src/a.ts': { contents: { kind: 'markdown', value: '`const a`' } } },
      'textDocument/definition': {
        '*': [
          {
            uri: '$ROOT/src/b.ts',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          },
        ],
      },
    },
  });
  expect(server.state).toEqual({ kind: 'starting' });
  expect(await server.ready).toBe(true);
  expect(server.state).toEqual({ kind: 'ready' });

  const initialize = seen().find((event) => event.event === 'initialize');
  expect(initialize?.params).toMatchObject({
    processId: process.pid,
    rootUri: pathToFileURL(root).href,
    workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'checkout' }],
    capabilities: {
      general: { positionEncodings: ['utf-16'] },
      workspace: { configuration: true },
    },
  });
  const capabilities = JSON.stringify(initialize?.params.capabilities);
  for (const never of ['completion', 'publishDiagnostics', 'rename', 'codeAction', 'applyEdit']) {
    expect(capabilities).not.toContain(never);
  }
  await eventually(() => seen().some((event) => event.event === 'initialized'));

  // Only a file Lo opened is asked about.
  expect(await hover(server)).toEqual({ ok: false, why: 'notOpen' });
  expect(server.open('src/a.ts', 'typescript', 'const a = 1;')).toBe(true);
  expect(await hover(server)).toEqual({
    ok: true,
    value: { contents: { kind: 'markdown', value: '`const a`' } },
  });
  expect(seen()).toContainEqual({
    event: 'opened',
    uri: pathToFileURL(join(root, 'src/a.ts')).href,
    text: 'const a = 1;',
  });

  // A location maps back to a path only inside the checkout.
  const definition = await server.request(
    'textDocument/definition',
    { path: 'src/a.ts', ...POSITION },
    { deadline: 5000 },
  );
  const b = pathToFileURL(join(root, 'src/b.ts')).href;
  expect(definition).toMatchObject({ ok: true, value: [{ uri: b }] });
  expect(server.pathOf(b)).toBe('src/b.ts');
  expect(server.pathOf('file:///etc/passwd')).toBeUndefined();

  // Past the limit, the file least recently asked about is closed.
  for (let file = 0; file < OPEN_LIMIT; file += 1) server.open(`src/${file}.ts`, 'typescript', '');
  await eventually(() => seen().some((event) => event.event === 'closed'));
  expect(seen().filter((event) => event.event === 'closed')).toEqual([
    { event: 'closed', uri: pathToFileURL(join(root, 'src/a.ts')).href },
  ]);
  expect(await hover(server)).toEqual({ ok: false, why: 'notOpen' });

  // Another head's checkout: the server moves there, with its files closed.
  const next = join(root, '..', 'next');
  mkdirSync(next);
  // Not if it's no longer wanted there once the folder is resolved.
  expect(await server.moveTo(next, () => false)).toBe(false);
  expect(server.pathOf(pathToFileURL(join(root, 'src/c.ts')).href)).toBe('src/c.ts');
  expect(await server.moveTo(next)).toBe(true);
  expect(server.pathOf(pathToFileURL(join(next, 'src/c.ts')).href)).toBe('src/c.ts');
  expect(server.pathOf(pathToFileURL(join(root, 'src/c.ts')).href)).toBeUndefined();
  await eventually(() =>
    seen().some(
      (event) =>
        event.event === 'notification' && event.method === 'workspace/didChangeWorkspaceFolders',
    ),
  );
});

test('a request past its deadline, given up or replaced is cancelled on the server', async () => {
  const { server, seen } = startFake({ delays: { 'textDocument/hover': 10_000 } });
  await server.ready;
  server.open('src/a.ts', 'typescript', 'const a = 1;');

  expect(await hover(server, { deadline: 100 })).toEqual({
    ok: false,
    why: 'deadline',
  });
  // Each is cancelled once the server is working on it, so its handler hears of the cancel.
  const working = (count: number) =>
    eventually(() => seen().filter((event) => event.event === 'request').length === count);
  const asker = new AbortController();
  const given = hover(server, {
    deadline: 10_000,
    signal: asker.signal,
  });
  await working(2);
  asker.abort();
  expect(await given).toEqual({ ok: false, why: 'cancelled' });
  const first = hover(server, { deadline: 10_000, key: 'hover' });
  await working(3);
  const later = new AbortController();
  const second = hover(server, {
    deadline: 10_000,
    key: 'hover',
    signal: later.signal,
  });
  expect(await first).toEqual({ ok: false, why: 'replaced' });
  await working(4);
  later.abort();
  expect(await second).toEqual({ ok: false, why: 'cancelled' });

  await eventually(() => seen().filter((event) => event.event === 'cancelled').length === 4);
  // One missed deadline isn't enough to call it not answering.
  expect(server.state).toEqual({ kind: 'ready' });
});

test('it gets its settings, registrations and progress, and is refused the rest', async () => {
  const { server, seen } = startFake(
    {
      stderr: ['Starting the fake server'],
      requests: [
        {
          method: 'workspace/configuration',
          params: { items: [{ section: 'fake.answer' }, { section: 'fake.missing' }] },
        },
        {
          method: 'client/registerCapability',
          params: { registrations: [{ id: '1', method: 'workspace/didChangeWatchedFiles' }] },
        },
        { method: 'window/workDoneProgress/create', params: { token: 'load' } },
        { method: 'workspace/applyEdit', params: { edit: { changes: {} } } },
        { method: 'window/showDocument', params: { uri: 'https://example.com', external: true } },
        {
          method: 'window/showMessageRequest',
          params: { type: 1, message: 'Run the build?', actions: [{ title: 'Run' }] },
        },
        { method: 'fake/unknown', params: {} },
      ],
      notifications: [
        {
          method: '$/progress',
          params: { token: 'load', value: { kind: 'begin', title: 'Loading', percentage: 40 } },
        },
        { method: 'window/logMessage', params: { type: 1, message: 'Something broke' } },
      ],
    },
    { spec: { settings: { fake: { answer: 42 } } } },
  );
  await server.ready;
  await eventually(() => server.state.kind === 'indexing');
  expect(server.state).toEqual({
    kind: 'indexing',
    progress: { title: 'Loading', percentage: 40 },
  });

  const replies = seen().flatMap((event) => (event.event === 'reply' ? [event] : []));
  expect(replies.slice(0, 3)).toEqual([
    { event: 'reply', method: 'workspace/configuration', result: [42, null] },
    { event: 'reply', method: 'client/registerCapability', result: null },
    { event: 'reply', method: 'window/workDoneProgress/create', result: null },
  ]);
  expect(replies.slice(3).map((refused) => [refused.method, refused.error?.code])).toEqual([
    ['workspace/applyEdit', -32601],
    ['window/showDocument', -32601],
    ['window/showMessageRequest', -32601],
    ['fake/unknown', -32601],
  ]);
  await eventually(() => server.log.includes('Error: Something broke'));
  expect(server.log).toContain('Starting the fake server');
  expect(server.log.some((line) => line.includes('refused the server’s workspace/applyEdit'))).toBe(
    true,
  );
});

test('a crash mid-request is seen with its exit code', async () => {
  const { server } = startFake({ crash: { requests: 1, code: 3 } });
  await server.ready;
  server.open('src/a.ts', 'typescript', '');
  expect(await hover(server)).toEqual({ ok: false, why: 'stopped' });
  expect(server.state).toEqual({
    kind: 'failed',
    failure: { kind: 'exited', code: 3, signal: null },
  });
  expect(failureMessage({ kind: 'exited', code: 3, signal: null })).toBe(
    'It quit with exit code 3.',
  );
  expect(server.log).toContain('Lo: it exited with code 3.');
});

test('a server that stops answering is not answering', async () => {
  const { server } = startFake({ hang: true });
  await server.ready;
  server.open('src/a.ts', 'typescript', '');
  const asks = [1, 2, 3].map(() => hover(server, { deadline: 50 }));
  expect(await Promise.all(asks)).toEqual(
    Array.from({ length: 3 }, () => ({ ok: false, why: 'deadline' })),
  );
  expect(server.state).toEqual({ kind: 'notAnswering' });
});

test('a server past its memory cap is stopped, with everything it started', async () => {
  // Above the fake server's own, and its child's, on Node: about 80 MB and 40 MB.
  const cap = 256 * 1024 * 1024;
  const { server, seen } = startFake(
    { memory: 512, child: true },
    { spec: { memoryCap: cap }, tuning: { memoryEvery: 100 } },
  );
  // It started well within the cap, and passed it only once it filled its memory.
  expect(await server.ready).toBe(true);
  await eventually(() => server.state.kind === 'failed');
  expect(server.state).toEqual({ kind: 'failed', failure: { kind: 'memory', cap } });
  expect(failureMessage({ kind: 'memory', cap })).toBe('It ran out of memory at 256 MB.');
  expect(failureMessage({ kind: 'memory', cap: 64 * 1024 * 1024 })).toBe(
    'It ran out of memory at 64 MB.',
  );
  expect(failureMessage({ kind: 'memory', cap: 4 * 1024 ** 3 })).toBe(
    'It ran out of memory at 4 GB.',
  );
  const pids = seen().flatMap((event) =>
    event.event === 'started' || event.event === 'child' ? [event.pid] : [],
  );
  await eventually(() => pids.every((pid) => !running(pid)));
});

test('its environment is built from nothing', async () => {
  // Lo's own environment, with a token, the SSH agent and proxies in it.
  for (const [name, value] of Object.entries({
    GITHUB_TOKEN: 'gho_FAKE_PLANTED_TOKEN',
    SSH_AUTH_SOCK: '/planted/agent.sock',
    HTTPS_PROXY: 'http://planted-proxy:3128',
    https_proxy: 'http://planted-proxy:3128',
    LO_PLANTED: 'planted-value',
  })) {
    vi.stubEnv(name, value);
  }
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const tools = tempFolder();
  const { server, home, root, seen } = startFake(
    {},
    { spec: { path: [tools], variables: { GOPROXY: 'off' } } },
  );
  await server.ready;
  const { text, names } = environmentOf(server.pid ?? 0);

  for (const own of [
    `HOME=${home}`,
    `TMPDIR=${join(home, 'tmp')}`,
    `PATH=${tools}:/usr/bin:/bin`,
    'GOPROXY=off',
    'LANG=C.UTF-8',
    'GIT_CONFIG_COUNT=1',
  ]) {
    expect(text).toContain(own);
  }
  for (const planted of [
    'GITHUB_TOKEN',
    'gho_FAKE',
    'SSH_AUTH_SOCK',
    '/planted/',
    'planted-proxy',
    'LO_PLANTED',
  ]) {
    expect(text).not.toContain(planted);
  }
  // Where the system lists them one by one: nothing but what Lo set.
  const set = 'GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 GOPROXY HOME LANG PATH TMPDIR';
  expect(names?.toSorted() ?? set.split(' ')).toEqual(set.split(' '));
  const started = seen().find((event) => event.event === 'started');
  expect(started).toMatchObject({ cwd: root, env: { HOME: home, PATH: `${tools}:/usr/bin:/bin` } });
  expect(existsSync(join(home, 'tmp'))).toBe(true);
  // A server not told of a cache gets no folder for one.
  expect(existsSync(join(home, 'cache'))).toBe(false);
});

test('a server with a cache keeps it in a folder of its home, whatever its options said', async () => {
  const { server, home, seen } = startFake(
    {},
    {
      spec: {
        initializationOptions: { phpVersion: '8.5', cachePath: '/elsewhere' },
        cacheOption: 'cachePath',
      },
    },
  );
  expect(await server.ready).toBe(true);
  const initialize = seen().find((event) => event.event === 'initialize');
  expect(initialize?.event === 'initialize' && initialize.params.initializationOptions).toEqual({
    phpVersion: '8.5',
    cachePath: join(home, 'cache'),
  });
  expect(readdirSync(home).toSorted()).toEqual(['cache', 'tmp']);

  // Options that aren't an object have nowhere to put it, so the server never starts.
  const refused = startFake(
    {},
    { spec: { initializationOptions: ['8.5'], cacheOption: 'cachePath' } },
  );
  expect(await refused.server.ready).toBe(false);
  expect(refused.server.state.kind === 'failed' && refused.server.state.failure).toEqual({
    kind: 'start',
    message: "Fake's initialization options aren't an object to add cachePath to.",
  });
  expect(refused.server.pid).toBeUndefined();
});

test('a stop answers what was asked, asks the server to exit, and ends its group', async () => {
  const { server, seen } = startFake({ child: true, delays: { 'textDocument/hover': 10_000 } });
  await server.ready;
  const child = await eventually(() => seen().find((event) => event.event === 'child'));
  server.open('src/a.ts', 'typescript', '');
  const asked = hover(server, { deadline: 10_000 });
  const states: State['kind'][] = [];
  server.onState((state) => states.push(state.kind));

  const stopped = server.stop();
  expect(await asked).toEqual({ ok: false, why: 'stopped' });
  await stopped;
  expect(states).toEqual(['stopping', 'stopped']);
  expect(seen().map((event) => event.event)).toEqual(expect.arrayContaining(['shutdown', 'exit']));
  await eventually(() => !running(child.pid));
  expect(await hover(server, { deadline: 100 })).toEqual({ ok: false, why: 'stopped' });
});

test('a server that ignores shutdown, exit and SIGTERM is killed inside the stop’s 5 s', async () => {
  const { server, seen } = startFake({ stubborn: true, child: true });
  await server.ready;
  const child = await eventually(() => seen().find((event) => event.event === 'child'));
  const pid = server.pid ?? 0;
  const started = performance.now();
  await server.stop();
  expect(performance.now() - started).toBeLessThan(5000);
  expect(server.state).toEqual({ kind: 'stopped' });
  await eventually(() => !running(pid) && !running(child.pid), 1000);
});

test('the longest a stop can take leaves a quarter of a second of a feature’s 5 s', () => {
  // `shutdown` and `exit`, a second each, with the family read inside the first; the family read
  // again, its group frozen; 2 s from SIGTERM to SIGKILL; then the freeze rounds and the wait for
  // the kill.
  expect(longestStop(LIMITS)).toBe(4750);
});

test('a stop while it starts never lets it initialize', async () => {
  const { server, seen } = startFake({ initialize: { hang: true } });
  await eventually(() => seen().some((event) => event.event === 'initialize'));
  const pid = server.pid ?? 0;
  await server.stop();
  expect(await server.ready).toBe(false);
  expect(server.state).toEqual({ kind: 'stopped' });
  expect(seen().some((event) => event.event === 'initialized')).toBe(false);
  await eventually(() => !running(pid), 1000);

  // Stopped before it spawned, it never runs.
  const early = startFake();
  await early.server.stop();
  expect(early.server.state).toEqual({ kind: 'stopped' });
  expect(early.server.pid).toBeUndefined();
  expect(early.seen()).toEqual([]);
});

test('it runs only a program of its own, outside the checkout', async () => {
  const folder = tempFolder();
  const root = join(folder, 'checkout');
  mkdirSync(root);
  const script = join(folder, 'launcher');
  writeFileSync(script, '#!/bin/sh\nexec node server.js\n');
  chmodSync(script, 0o755);
  const inside = join(root, 'node');
  writeFileSync(inside, 'binary');
  chmodSync(inside, 0o755);
  for (const [program, why] of [
    [join(folder, 'missing'), 'isn’t there'],
    [script, 'is a script'],
    [inside, 'inside the checkout'],
    ['node', 'isn’t an absolute path'],
  ] as const) {
    const server = startServer({
      name: 'Fake',
      program,
      args: [],
      root,
      home: join(folder, 'home'),
      path: [],
      git: GIT,
    });
    onTestFinished(() => server.stop());
    expect(await server.ready).toBe(false);
    expect(server.state.kind).toBe('failed');
    expect(server.state.kind === 'failed' && failureMessage(server.state.failure)).toContain(why);
    expect(server.pid).toBeUndefined();
  }
});

test('a bad answer to initialize, or a message too large, fails the server', async () => {
  const wrong = startFake({
    initialize: { result: { capabilities: { positionEncoding: 'utf-8' } } },
  });
  expect(await wrong.server.ready).toBe(false);
  expect(wrong.server.state).toMatchObject({ kind: 'failed', failure: { kind: 'initialize' } });

  const large = startFake({
    flood: { at: 'initialized', header: `Content-Length: ${100 * 1024 * 1024}\r\n\r\n` },
  });
  await large.server.ready;
  await eventually(() => large.server.state.kind === 'failed');
  expect(large.server.state).toMatchObject({
    kind: 'failed',
    failure: { kind: 'protocol', message: expect.stringContaining('past the limit') },
  });
});

test('a message with two lengths fails the server, whichever the reader would take', async () => {
  // The reader takes the last length and the meter once took the first: 400 MB went unmeasured.
  const { server, seen } = startFake({
    flood: { at: 'initialized', header: 'Content-Length: 10\r\nContent-Length: 400000000\r\n\r\n' },
  });
  await server.ready;
  await eventually(() => server.state.kind === 'failed');
  expect(server.state).toMatchObject({
    kind: 'failed',
    failure: { kind: 'protocol', message: 'It sent a message with two lengths.' },
  });
  const pid = seen().find((event) => event.event === 'started')?.pid ?? 0;
  await eventually(() => !running(pid));
});

test('a server that breaks a limit while it stops is killed at once', async () => {
  // Asked to shut down, it floods behind a header of 999 GB in place of its answer, ignoring exit
  // and SIGTERM.
  const { server, seen } = startFake({
    flood: { at: 'shutdown', header: `Content-Length: ${999 * 1024 ** 3}\r\n\r\n` },
  });
  await server.ready;
  const pid = server.pid ?? 0;
  const started = performance.now();
  await server.stop();
  // Well before the stop's own SIGTERM and SIGKILL, 2 s and 4 s in.
  expect(performance.now() - started).toBeLessThan(2000);
  expect(seen().some((event) => event.event === 'shutdown')).toBe(true);
  expect(server.log.some((line) => line.includes('past the limit'))).toBe(true);
  expect(server.state).toEqual({ kind: 'stopped' });
  expect(running(pid)).toBe(false);
});

test('a flood of valid messages fails the server that sends it', async () => {
  const { server, seen } = startFake(
    { flood: { at: 'initialized', header: '', frame: NOTIFICATION } },
    { tuning: { floodMessages: 20_000 } },
  );
  expect(await server.ready).toBe(true);
  await eventually(() => server.state.kind === 'failed');
  expect(server.state).toEqual({
    kind: 'failed',
    failure: { kind: 'protocol', message: 'It sent more than 20,000 messages in 10 s.' },
  });
  const pid = seen().find((event) => event.event === 'started')?.pid ?? 0;
  await eventually(() => !running(pid));
});

test('a flood of lines on stderr fails the server that writes it', async () => {
  // Empty lines: 400 MB of them in half a minute never reached the limit on bytes.
  const { server, seen } = startFake({
    flood: { at: 'initialized', header: '', frame: '\n'.repeat(64 * 1024), stderr: 'only' },
  });
  expect(await server.ready).toBe(true);
  await eventually(() => server.state.kind === 'failed');
  expect(server.state).toEqual({
    kind: 'failed',
    failure: { kind: 'protocol', message: 'It wrote more than 50,000 lines to stderr in 10 s.' },
  });
  const pid = seen().find((event) => event.event === 'started')?.pid ?? 0;
  await eventually(() => !running(pid));
});

test('a message of many lines is logged without keeping main from its turns', async () => {
  // Main once split and cleaned every line it holds, all in one turn.
  const lines = 8 * 1024 * 1024;
  const message = `${'\n'.repeat(lines)}logged`;
  const { server } = startFake({
    notifications: [{ method: 'window/logMessage', params: { type: 3, message }, delay: 100 }],
  });
  expect(await server.ready).toBe(true);
  const lag = watchLag();
  await eventually(() => server.log.at(-1) === 'logged');
  expect(lag()).toBeLessThan(200);
  expect(server.log.slice(-3)).toEqual(['', '', 'logged']);
});

test('main reads a flood a turn at a time, and a stop keeps its time however much is sent', async () => {
  // With no limit on its rate, only how it's read keeps main's turns.
  const unlimited = startFake(
    { flood: { at: 'initialized', header: '', frame: NOTIFICATION } },
    {
      tuning: { floodMessages: Number.MAX_SAFE_INTEGER, floodBytes: Number.MAX_SAFE_INTEGER },
    },
  );
  expect(await unlimited.server.ready).toBe(true);
  expect(unlimited.server.open('src/a.ts', 'typescript', 'const a = 1;')).toBe(true);
  const lag = watchLag();
  await sleep(1000);
  // Lo holds only a little of the flood at a time, so an answer behind a second of it comes soon.
  expect(await hover(unlimited.server, { deadline: 1000 })).toEqual({ ok: true, value: null });
  expect(lag()).toBeLessThan(200);
  expect(unlimited.server.state).toEqual({ kind: 'ready' });
  await unlimited.server.stop();

  // It answers shutdown, then floods its log, ignoring exit and SIGTERM. Nothing it sends after
  // its answer is read, so none of the flood reaches the log, and the stop keeps its time.
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'window/logMessage',
    params: { type: 3, message: 'flooding' },
  });
  const { server, seen } = startFake({
    flood: {
      at: 'afterShutdown',
      header: '',
      frame: `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    },
  });
  expect(await server.ready).toBe(true);
  const pid = server.pid ?? 0;
  const stopLag = watchLag();
  const started = performance.now();
  await server.stop();
  expect(performance.now() - started).toBeLessThan(5000);
  expect(stopLag()).toBeLessThan(200);
  expect(seen().some((event) => event.event === 'shutdown')).toBe(true);
  expect(server.log.filter((line) => line.includes('flooding'))).toEqual([]);
  expect(server.state).toEqual({ kind: 'stopped' });
  await eventually(() => !running(pid), 1000);
});

test('a server stopped while it floods leaves no pipe open', async () => {
  const folder = process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd';
  const open = () => readdirSync(folder).length;
  const before = open();
  // It floods stderr too, so what's left in that pipe when it exits is never read to its end.
  const { server } = startFake({
    flood: { at: 'afterShutdown', header: '', frame: NOTIFICATION, stderr: true },
  });
  expect(await server.ready).toBe(true);
  await server.stop();
  await eventually(() => open() <= before, 2000);
});

test('a kill freezes what left the group, round after round, before it kills anything', async () => {
  // Its escapee starts a sleeper in a session of its own every 5 ms; once its memory reads past
  // the cap, the server is killed.
  let past = false;
  const { server, seen } = startFake(
    { escapee: true, sleepers: 'escapee' },
    {
      tuning: {
        memoryEvery: 50,
        readFamily: async (group, also) => {
          const family = await readFamily(group, also);
          return past ? family.map((member) => ({ ...member, resident: 8 * 1024 ** 3 })) : family;
        },
      },
    },
  );
  expect(await server.ready).toBe(true);
  const sleepers = () => seen().flatMap((event) => (event.event === 'sleeper' ? [event.pid] : []));
  await eventually(() => sleepers().length >= 10);
  past = true;
  await eventually(() => server.state.kind === 'failed');
  expect(server.state).toMatchObject({ kind: 'failed', failure: { kind: 'memory' } });
  const escapee = seen().find((event) => event.event === 'escapee')?.pid ?? 0;
  await eventually(() => [escapee, ...sleepers()].every((pid) => !running(pid)), 3000);
});

test('a process read as the server stopped, and since another, is left alone', async () => {
  const other = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  onTestFinished(() => {
    other.kill('SIGKILL');
  });
  const pid = other.pid ?? 0;
  // The read as the server shuts down finds a process of its own with the other's ID, started
  // before it: the server's, which has since ended, and the ID taken again.
  let stopping = false;
  const { server } = startFake(
    {},
    {
      tuning: {
        memoryEvery: 60_000,
        readFamily: async (group, also) => {
          const family = await readFamily(group, also);
          if (!stopping) return family;
          stopping = false;
          return [
            ...family,
            { pid, parent: group, group: pid, started: 'Thu Jan  1 00:00:00 1970' },
          ];
        },
      },
    },
  );
  expect(await server.ready).toBe(true);
  stopping = true;
  await server.stop();
  await sleep(200);
  expect(running(pid)).toBe(true);
  expect(other.signalCode).toBeNull();
});

test('nothing leaves the group unseen between a stop’s last read of the family and SIGTERM', async () => {
  // A child in the group starts a sleeper outside it (`setsid`) every 5 ms, and each read of the
  // family is 150 ms old by the time it's used: what the child starts meanwhile is in no read.
  const { server, seen } = startFake(
    { child: true, sleepers: 'child' },
    {
      tuning: {
        memoryEvery: 60_000,
        family: 1000,
        readFamily: async (group, also) => {
          const family = await readFamily(group, also);
          await sleep(150);
          return family;
        },
      },
    },
  );
  expect(await server.ready).toBe(true);
  const sleepers = () => seen().flatMap((event) => (event.event === 'sleeper' ? [event.pid] : []));
  await eventually(() => sleepers().length >= 10);
  await server.stop();
  await eventually(() => sleepers().every((pid) => !running(pid)), 2000);
});

test('a kill that begins during a stop’s frozen read keeps the group frozen until it’s killed', async () => {
  // The server and its child ignore SIGTERM, and the child starts a sleeper outside the group
  // (`setsid`) every 5 ms. As the stop reads the family with the group frozen, the server's memory
  // reads past its cap, so a kill begins; the stop's read ends while the kill's second round reads.
  let reads = 0;
  let past = false;
  const { promise: secondRound, resolve: reachedSecondRound } = Promise.withResolvers<void>();
  const { server, seen } = startFake(
    { stubborn: true, child: true, sleepers: 'child' },
    {
      tuning: {
        memoryEvery: 50,
        family: 5000,
        freeze: 5000,
        readFamily: async (group, also) => {
          const family = await readFamily(group, also);
          // A read of its memory.
          if (also === undefined) {
            return past ? family.map((member) => ({ ...member, resident: 8 * 1024 ** 3 })) : family;
          }
          reads += 1;
          if (reads === 2) {
            // The stop's read with the group frozen.
            past = true;
            await secondRound;
          } else if (reads === 4) {
            // The kill's second round, read.
            reachedSecondRound();
            await sleep(150);
          }
          return family;
        },
      },
    },
  );
  expect(await server.ready).toBe(true);
  const sleepers = () => seen().flatMap((event) => (event.event === 'sleeper' ? [event.pid] : []));
  await eventually(() => sleepers().length >= 10);
  await server.stop();
  expect(reads).toBeGreaterThanOrEqual(4);
  await eventually(() => sleepers().every((pid) => !running(pid)), 2000);
});

test('a stop whose last read of the family takes too long still signals what it found before', async () => {
  // The read as the server shuts down finds its escapee; each read after never ends.
  let reads = 0;
  const { server, seen } = startFake(
    { escapee: true },
    {
      tuning: {
        memoryEvery: 60_000,
        readFamily: (group, also) => {
          if (also !== undefined) reads += 1;
          return reads > 1 ? new Promise(() => undefined) : readFamily(group, also);
        },
      },
    },
  );
  expect(await server.ready).toBe(true);
  const escapee = await eventually(() => seen().find((event) => event.event === 'escapee'));
  await server.stop();
  expect(reads).toBe(2);
  await eventually(() => !running(escapee.pid), 1000);
});

test('a stop whose last read of the family fails leaves alone an ID found before that another process has taken since', async () => {
  const other = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  onTestFinished(() => {
    other.kill('SIGKILL');
  });
  const pid = other.pid ?? 0;
  // The read as the server shuts down finds a process outside its group with the other's ID,
  // started before it: the server's, which has since ended, and the ID taken again. Each read
  // after fails.
  let reads = 0;
  const { server } = startFake(
    {},
    {
      tuning: {
        memoryEvery: 60_000,
        readFamily: async (group, also) => {
          if (also === undefined) return readFamily(group, also);
          reads += 1;
          if (reads > 1) throw new Error('ps failed');
          return [
            ...(await readFamily(group, also)),
            { pid, parent: group, group: pid, started: 'Thu Jan  1 00:00:00 1970' },
          ];
        },
      },
    },
  );
  expect(await server.ready).toBe(true);
  await server.stop();
  expect(reads).toBe(2);
  await sleep(200);
  expect(running(pid)).toBe(true);
  expect(other.signalCode).toBeNull();
});

test('what a server started in a session of its own is stopped with it', async () => {
  const { server, seen } = startFake({ escapee: true });
  await server.ready;
  const escapee = await eventually(() => seen().find((event) => event.event === 'escapee'));
  // It left the server's group, so only its parent ties it to the server.
  expect(running(escapee.pid)).toBe(true);
  await server.stop();
  await eventually(() => !running(escapee.pid), 1000);
});

test('memory that can’t be read stops the server, since its cap would go unenforced', async () => {
  const { server } = startFake(
    {},
    {
      tuning: {
        memoryEvery: 50,
        readFamily: () => Promise.reject(new Error('ps failed')),
      },
    },
  );
  await eventually(() => server.state.kind === 'failed');
  expect(server.state).toEqual({ kind: 'failed', failure: { kind: 'memoryUnread' } });
  expect(server.log).toContain('Lo: couldn’t read its memory: Error: ps failed');
});

test('the program that runs is the one checked, and no folder resolves into the checkout', async () => {
  // A program by a link runs by its real path, so changing the link after the check changes nothing.
  const link = join(tempFolder(), 'node');
  symlinkSync(process.execPath, link);
  const { server, seen } = startFake({}, { spec: { program: link } });
  await server.ready;
  expect(seen().find((event) => event.event === 'started')).toMatchObject({
    argv0: realpathSync(process.execPath),
  });

  // The checkout as given, which on a Mac isn't as the system resolves it, and links into it.
  const folder = mkdtempSync(join(tmpdir(), 'lo-lsp-'));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  const root = join(folder, 'checkout');
  mkdirSync(join(root, 'bin'), { recursive: true });
  symlinkSync(join(root, 'bin'), join(folder, 'tools'));
  symlinkSync(root, join(folder, 'home'));
  const fake = fakeServer(folder);
  const cases = [
    { path: [join(root, 'bin')], home: join(folder, 'own') },
    { path: [join(folder, 'tools')], home: join(folder, 'own') },
    { path: [], home: join(folder, 'home', '.home') },
  ];
  for (const { path, home } of cases) {
    const refused = startServer({
      name: 'Fake',
      program: fake.program,
      args: fake.args,
      root,
      home,
      path,
      git: GIT,
    });
    onTestFinished(() => refused.stop());
    expect(await refused.ready).toBe(false);
    expect(refused.state).toMatchObject({
      kind: 'failed',
      failure: { kind: 'start', message: expect.stringContaining('outside its checkout') },
    });
  }
  // A home that would resolve into the checkout is refused before any of it is made.
  expect(existsSync(join(root, '.home'))).toBe(false);
});
