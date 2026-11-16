/**
 * A fake language server, for tests: it speaks the protocol over stdio and does what its scenario
 * file says (`scenario.ts`), reporting what it sees. Node runs it as it is, stripping its types:
 *
 *   node testing/lsp/fake-server.ts <scenario.json>
 */

import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

import {
  AbstractMessageWriter,
  type CancellationToken,
  createMessageConnection,
  type Message,
  type MessageWriter,
  ResponseError,
  StreamMessageReader,
} from 'vscode-jsonrpc/node';

import type { Scenario, Seen } from './scenario.ts';

/** The protocol's code for a request the client cancelled. */
const REQUEST_CANCELLED = -32800;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test wrote it as a Scenario.
const scenario = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')) as Scenario;

function report(seen: Seen): void {
  appendFileSync(scenario.report, `${JSON.stringify(seen)}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits `ms`, and says whether `token` was cancelled first. */
function wait(ms: number, token: CancellationToken): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(token.isCancellationRequested);
  return new Promise((resolve) => {
    const listener = token.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve(true);
    });
    const timer = setTimeout(() => {
      listener.dispose();
      resolve(false);
    }, ms);
  });
}

/** A promise that never settles: an answer that never comes. */
function never(): Promise<never> {
  return new Promise(() => undefined);
}

const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
report({
  event: 'started',
  pid: process.pid,
  argv0: process.argv0,
  execArgv: process.execArgv,
  env,
  cwd: process.cwd(),
});
for (const line of scenario.stderr ?? []) process.stderr.write(`${line}\n`);
if (scenario.stubborn) process.on('SIGTERM', () => undefined);

/**
 * Writes each message, header and body, in one piece, so a flood written beside it never lands
 * inside one.
 */
class WholeWriter extends AbstractMessageWriter implements MessageWriter {
  write(message: Message): Promise<void> {
    const body = JSON.stringify(message);
    return new Promise((resolve) => {
      process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, () =>
        resolve(),
      );
    });
  }

  end(): void {
    // stdout stays open until it exits.
  }
}

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new WholeWriter(),
);

/** The checkout's URI, from `initialize`, which `$ROOT` in an answer stands for. */
let rootUri = '';
let requests = 0;
/** The memory it fills, kept so it stays filled. */
const kept: Buffer[] = [];

/** The URI of the file a request's `params` name. */
function uriOf(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null || !('textDocument' in params))
    return undefined;
  const { textDocument } = params;
  if (typeof textDocument !== 'object' || textDocument === null) return undefined;
  return 'uri' in textDocument && typeof textDocument.uri === 'string'
    ? textDocument.uri
    : undefined;
}

/** The scenario's answer to `method` about the file `params` names. */
function answerFor(method: string, params: unknown): unknown {
  const byFile = scenario.answers?.[method];
  if (byFile === undefined) return null;
  const uri = uriOf(params) ?? '';
  const path = Object.keys(byFile).find((file) => file !== '*' && uri.endsWith(`/${file}`));
  const answer = byFile[path ?? '*'] ?? null;
  return JSON.parse(JSON.stringify(answer).replaceAll('$ROOT', rootUri)) as unknown;
}

connection.onRequest('initialize', async (params: { rootUri?: string }) => {
  report({ event: 'initialize', params });
  rootUri = params.rootUri ?? '';
  const { result, delay = 0, hang = false } = scenario.initialize ?? {};
  if (hang) return never();
  await sleep(delay);
  return (
    result ?? {
      capabilities: {
        textDocumentSync: { openClose: true, change: 1 },
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        inlayHintProvider: true,
        documentSymbolProvider: true,
        workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
      },
      serverInfo: { name: 'fake' },
    }
  );
});

/** Whether it floods once asked to shut down, and so ignores `exit` and `SIGTERM`. */
const floodsAtShutdown =
  scenario.flood?.at === 'shutdown' || scenario.flood?.at === 'afterShutdown';

connection.onRequest('shutdown', () => {
  report({ event: 'shutdown' });
  if (floodsAtShutdown) process.on('SIGTERM', () => undefined);
  if (scenario.flood?.at === 'shutdown') {
    flood();
    return never();
  }
  // After its answer has gone.
  if (scenario.flood?.at === 'afterShutdown') setTimeout(flood, 50);
  return scenario.stubborn ? never() : null;
});

connection.onRequest(async (method: string, params: unknown, token: CancellationToken) => {
  report({ event: 'request', method, params });
  requests += 1;
  if (scenario.crash !== undefined && requests >= scenario.crash.requests) {
    process.exit(scenario.crash.code);
  }
  if (scenario.hang) return never();
  if (await wait(scenario.delays?.[method] ?? 0, token)) {
    report({ event: 'cancelled', method });
    return new ResponseError(REQUEST_CANCELLED, 'Cancelled.');
  }
  return answerFor(method, params);
});

connection.onNotification('exit', () => {
  report({ event: 'exit' });
  if (!scenario.stubborn && !floodsAtShutdown) process.exit(0);
});

connection.onNotification('initialized', () => {
  report({ event: 'initialized' });
  afterInitialized().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
  });
});

connection.onNotification(
  'textDocument/didOpen',
  (params: { textDocument: { uri: string; text: string } }) => {
    report({ event: 'opened', uri: params.textDocument.uri, text: params.textDocument.text });
  },
);

connection.onNotification('textDocument/didClose', (params: { textDocument: { uri: string } }) => {
  report({ event: 'closed', uri: params.textDocument.uri });
});

connection.onNotification((method: string, params: unknown) => {
  report({ event: 'notification', method, params });
});

// Lo has gone: nothing more can come.
connection.onClose(() => {
  if (!scenario.stubborn && scenario.flood === undefined) process.exit(0);
});

/** A process that waits until it's killed. */
const IDLE = 'setInterval(() => {}, 1 << 30)';

/** What makes a process ignore `SIGTERM`, before its script. */
const STUBBORN = "process.on('SIGTERM', () => undefined);\n";

/**
 * A process that starts a sleeper in a session of its own every 5 ms, reporting each to the report
 * it's given, until it's killed.
 */
const SLEEPERS = `
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
setInterval(() => {
  const sleeper = spawn('/bin/sleep', ['120'], { stdio: 'ignore', detached: true });
  appendFileSync(process.argv[1], JSON.stringify({ event: 'sleeper', pid: sleeper.pid }) + '\\n');
}, 5);
`;

/**
 * Writes the flood's header, then its frame, to stdout, to stderr too or stderr alone if it says,
 * until the pipe breaks or it's killed.
 */
function flood(): void {
  const { header = '', frame = 'x'.repeat(64 * 1024), stderr = false } = scenario.flood ?? {};
  const streams =
    stderr === 'only'
      ? [process.stderr]
      : stderr
        ? [process.stdout, process.stderr]
        : [process.stdout];
  if (stderr !== 'only') process.stdout.write(header);
  for (const stream of streams) {
    stream.on('error', () => undefined);
    const more = (): void => {
      while (stream.write(frame)) {
        // The pipe takes it.
      }
      stream.once('drain', more);
    };
    more();
  }
}

async function afterInitialized(): Promise<void> {
  if (scenario.child) {
    // A stubborn server's child ignores `SIGTERM` too.
    const script = `${scenario.stubborn ? STUBBORN : ''}${scenario.sleepers === 'child' ? SLEEPERS : IDLE}`;
    const child = spawn(process.execPath, ['-e', script, scenario.report], { stdio: 'ignore' });
    report({ event: 'child', pid: child.pid ?? 0 });
  }
  if (scenario.escapee) {
    const escapee = spawn(
      process.execPath,
      ['-e', scenario.sleepers === 'escapee' ? SLEEPERS : IDLE, scenario.report],
      {
        stdio: 'ignore',
        detached: true,
      },
    );
    report({ event: 'escapee', pid: escapee.pid ?? 0 });
  }
  for (let megabyte = 0; megabyte < (scenario.memory ?? 0); megabyte += 1) {
    kept.push(Buffer.alloc(1024 * 1024, 1));
  }
  for (const { method, params, delay = 0 } of scenario.requests ?? []) {
    await sleep(delay);
    try {
      const result: unknown = await connection.sendRequest(method, params);
      report({ event: 'reply', method, result });
    } catch (error) {
      if (!(error instanceof ResponseError)) throw error;
      report({ event: 'reply', method, error: { code: error.code, message: error.message } });
    }
  }
  for (const { method, params, delay = 0 } of scenario.notifications ?? []) {
    await sleep(delay);
    await connection.sendNotification(method, params);
  }
  if (scenario.flood?.at === 'initialized') flood();
}

connection.listen();
