// The test servers' manifest: read only by a build run from source, and only as a test writes it.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { ADAPTERS } from './adapters.ts';
import { adaptersFor, readTestServers, testServersFile } from './tests.ts';

function refuse(): Promise<never> {
  return Promise.reject(new Error('nothing is downloaded'));
}

function ids(adapters: readonly { id: string }[]): string[] {
  return adapters.map((adapter) => adapter.id);
}

function manifest(value: unknown): string {
  const folder = mkdtempSync(join(tmpdir(), 'lo-test-servers-'));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'servers.json');
  writeFileSync(file, JSON.stringify(value));
  return file;
}

describe('test servers', () => {
  it('are named only in a build run from source, by an absolute path', () => {
    const env = { LO_TEST_SERVERS: '/tmp/servers.json' };
    expect(testServersFile({ packaged: true, env })).toBeUndefined();
    expect(testServersFile({ packaged: false, env })).toBe('/tmp/servers.json');
    expect(testServersFile({ packaged: false, env: {} })).toBeUndefined();
    expect(() =>
      testServersFile({ packaged: false, env: { LO_TEST_SERVERS: 'servers.json' } }),
    ).toThrow('absolute path');
  });

  it('start as the manifest says, with nothing downloaded', async () => {
    const file = manifest({
      servers: [
        {
          id: 'typescript',
          name: 'TypeScript',
          languages: { typescript: 'typescript', tsx: 'typescriptreact' },
          program: '/usr/local/bin/node',
          args: ['/repo/testing/lsp/fake-server.ts', '/tmp/scenario.json'],
        },
      ],
    });
    const [server] = readTestServers(file);
    expect(server).toMatchObject({
      id: 'typescript',
      name: 'TypeScript',
      languages: { typescript: 'typescript', tsx: 'typescriptreact' },
    });
    const signal = new AbortController().signal;
    expect(
      await server?.prepare({ install: refuse, toolchain: refuse, findCopy: refuse, signal }),
    ).toEqual({
      kind: 'ready',
      launch: {
        program: '/usr/local/bin/node',
        args: ['/repo/testing/lsp/fake-server.ts', '/tmp/scenario.json'],
      },
    });
  });

  it('refuse a manifest Lo can’t use', () => {
    const relative = manifest({
      servers: [{ id: 'ts', name: 'TS', languages: {}, program: 'node', args: [] }],
    });
    expect(() => readTestServers(relative)).toThrow("Lo can't use");
    const unknown = manifest({
      servers: [
        { id: 'ts', name: 'TS', languages: { cobol: 'cobol' }, program: '/bin/x', args: [] },
      ],
    });
    expect(() => readTestServers(unknown)).toThrow("Lo can't use");
  });

  it('take the place of Lo’s own servers, which a test run never starts', () => {
    const file = manifest({
      servers: [
        { id: 'typescript', name: 'TypeScript', languages: {}, program: '/bin/x', args: [] },
      ],
    });
    const env = { LO_TEST_SERVERS: file };
    const shipped = ADAPTERS;
    expect(ids(adaptersFor({ packaged: true, env, testRun: false, shipped }))).toEqual([
      'typescript',
      'python',
      'php',
    ]);
    expect(adaptersFor({ packaged: false, env: {}, testRun: false, shipped })).toBe(shipped);
    expect(adaptersFor({ packaged: false, env: {}, testRun: true, shipped })).toEqual([]);
    for (const testRun of [false, true]) {
      const adapters = adaptersFor({ packaged: false, env, testRun, shipped });
      expect(ids(adapters)).toEqual(['typescript']);
      expect(adapters[0]).not.toBe(shipped[0]);
    }
  });
});
