/**
 * A fake language server, for tests: it speaks the protocol over stdio and does what its scenario
 * file says (`scenario.ts`), reporting what it sees. Node runs it as it is, stripping its types:
 *
 *   node testing/lsp/fake-server.ts <scenario.json>
 */

import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

import {
  type CancellationToken,
  createMessageConnection,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
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
report({ event: 'started', pid: process.pid, env, cwd: process.cwd() });
for (const line of scenario.stderr ?? []) process.stderr.write(`${line}\n`);
if (scenario.stubborn) process.on('SIGTERM', () => undefined);

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
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

connection.onRequest('shutdown', () => {
  report({ event: 'shutdown' });
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
  if (!scenario.stubborn) process.exit(0);
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
  if (!scenario.stubborn) process.exit(0);
});

async function afterInitialized(): Promise<void> {
  if (scenario.child) {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], {
      stdio: 'ignore',
    });
    report({ event: 'child', pid: child.pid ?? 0 });
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
  if (scenario.oversized !== undefined) {
    process.stdout.write(`Content-Length: ${scenario.oversized}\r\n\r\n{"jsonrpc":"2.0",`);
  }
}

connection.listen();
