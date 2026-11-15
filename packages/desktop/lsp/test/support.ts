import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fakeServer, readReport, type Scenario, type Seen } from '@lo/testing/lsp';
import { onTestFinished } from 'vitest';

import { type Limits, type Server, type ServerSpec, startServer } from '../src/index.ts';

/** Stand-ins for the variables `@lo/git` sets up a server's git with. */
export const GIT = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'safe.bareRepository',
  GIT_CONFIG_VALUE_0: 'explicit',
};

/** A new empty folder, as the system resolves it, removed when the test ends. */
export function tempFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-lsp-')));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

export interface Fake {
  readonly server: Server;
  /** The checkout it runs on. */
  readonly root: string;
  readonly home: string;
  /** What the fake server has reported so far. */
  readonly seen: () => Seen[];
}

/**
 * Starts the fake server on `scenario`, on a checkout of its own. When the test ends, its group is
 * killed, and anything it started.
 */
export function startFake(
  scenario: Omit<Scenario, 'report'> = {},
  options: { spec?: Partial<ServerSpec>; limits?: Partial<Limits> } = {},
): Fake {
  const folder = tempFolder();
  const root = join(folder, 'checkout');
  mkdirSync(join(root, 'src'), { recursive: true });
  const home = join(folder, 'home');
  const fake = fakeServer(folder, scenario);
  const server = startServer(
    {
      name: 'Fake',
      program: fake.program,
      args: fake.args,
      root,
      home,
      path: [],
      git: GIT,
      ...options.spec,
    },
    options.limits,
  );
  const seen = () => readReport(fake.report);
  onTestFinished(async () => {
    const pids = seen().flatMap((event) => (event.event === 'child' ? [event.pid] : []));
    if (server.pid !== undefined) pids.push(-server.pid);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // It's gone.
      }
    }
    await server.stop();
  });
  return { server, root, home, seen };
}

/** Waits until `check` returns something other than `undefined` or `false`, and returns it. */
export async function eventually<T>(
  check: () => T | undefined | false,
  within = 10_000,
): Promise<T> {
  const until = performance.now() + within;
  for (;;) {
    const value = check();
    if (value !== undefined && value !== false) return value;
    if (performance.now() > until) throw new Error(`still waiting after ${within} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Whether the process `pid` is still running. */
export function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
