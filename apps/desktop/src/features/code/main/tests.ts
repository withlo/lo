// Test servers: a build run from source runs the language servers a manifest names, in
// `LO_TEST_SERVERS`, for its tests, which start only the fake server, in place of Lo's own. Each
// runs as given, by an absolute path with an argument list, with nothing downloaded. A packaged
// build never reads the variable, nor the file it names. Nothing here calls Electron.

import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { languageNames, type LanguageName } from '@lo/syntax';
import { z } from 'zod';

import type { Adapter } from './adapters.ts';

type Environment = Readonly<Record<string, string | undefined>>;

const language = z
  .string()
  .refine((name): name is LanguageName => languageNames.some((known) => known === name));

const server = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  name: z.string().min(1).max(40),
  /** The languages it reads, each with the id the protocol names it by. */
  languages: z.record(language, z.string().min(1).max(40)),
  program: z.string().refine(isAbsolute, 'an absolute path'),
  args: z.array(z.string().max(4096)).max(64),
  definitionDeadline: z.number().int().positive().max(60_000).optional(),
});

const manifest = z.strictObject({ servers: z.array(server).max(8) });

/**
 * The manifest `LO_TEST_SERVERS` names, in a build run from source: nothing in a packaged one,
 * whatever the environment says.
 */
export function testServersFile(options: {
  packaged: boolean;
  env: Environment;
}): string | undefined {
  if (options.packaged) return undefined;
  const file = options.env.LO_TEST_SERVERS;
  if (file === undefined || file === '') return undefined;
  if (!isAbsolute(file)) {
    throw new Error(`LO_TEST_SERVERS must be an absolute path, not "${file}".`);
  }
  return file;
}

/**
 * The adapters Lo runs: its own, `shipped`, unless it's a build run from source for a test. That
 * runs only the servers `LO_TEST_SERVERS` names, or, in a test run without it, none, so no test
 * starts or downloads a real server.
 */
export function adaptersFor(options: {
  packaged: boolean;
  env: Environment;
  /**
   * Whether it's a test run: a build run from source talking to a GitHub on this machine, which a
   * packaged build never is.
   */
  testRun: boolean;
  shipped: readonly Adapter[];
}): readonly Adapter[] {
  const file = testServersFile(options);
  if (file !== undefined) return readTestServers(file);
  return options.testRun ? [] : options.shipped;
}

/**
 * The adapters a test manifest describes, read from `file` as Lo starts. It throws on one Lo can't
 * use, so a test that mistypes one finds out.
 */
export function readTestServers(file: string): Adapter[] {
  const parsed = manifest.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `LO_TEST_SERVERS names a manifest Lo can't use: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data.servers.map((each): Adapter => ({
    id: each.id,
    name: each.name,
    languages: each.languages,
    definitionDeadline: each.definitionDeadline,
    prepare: () =>
      Promise.resolve({ kind: 'ready', launch: { program: each.program, args: each.args } }),
  }));
}
