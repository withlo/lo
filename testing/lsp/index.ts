/**
 * The fake language server, for tests of what runs servers. A test writes a scenario, starts the
 * server with the program and arguments `fakeServer` gives, and reads what it saw from its report.
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Scenario, Seen } from './scenario.ts';

export type { Outgoing, Scenario, Seen } from './scenario.ts';

/** The fake server's script, by its real path: Node strips types only outside `node_modules`. */
export const FAKE_SERVER = realpathSync(
  fileURLToPath(new URL('./fake-server.ts', import.meta.url)),
);

/** How to start the fake server: Node, with its script and the scenario file. */
export interface FakeServer {
  readonly program: string;
  readonly args: readonly string[];
  /** Where it reports what it sees. */
  readonly report: string;
}

/** Writes `scenario` into `folder`, and says how to start the fake server on it. */
export function fakeServer(folder: string, scenario: Omit<Scenario, 'report'> = {}): FakeServer {
  const report = join(folder, 'report.jsonl');
  const file = join(folder, 'scenario.json');
  writeFileSync(file, JSON.stringify({ ...scenario, report }));
  return { program: process.execPath, args: [FAKE_SERVER, file], report };
}

/** What the fake server has reported so far, in order, up to its last whole line. */
export function readReport(report: string): Seen[] {
  if (!existsSync(report)) return [];
  const text = readFileSync(report, 'utf8');
  return (
    text
      .slice(0, text.lastIndexOf('\n') + 1)
      .split('\n')
      .filter((line) => line !== '')
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake server wrote it.
      .map((line) => JSON.parse(line) as Seen)
  );
}
