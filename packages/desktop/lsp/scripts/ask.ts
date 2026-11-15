// What the live check asks a server: a hover and a definition, at a place in its language's sample
// project, printing what came back.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type ServerSpec, startServer } from '../src/index.ts';

/** What a server's check asks: a hover and a definition at a place in its sample project. */
export interface Ask {
  /** How to start it, on its sample project in `testing/fixtures/code/<language>/`. */
  readonly spec: ServerSpec;
  readonly languageId: string;
  /** The file to ask about, inside the sample project, and the place in it. */
  readonly file: string;
  readonly position: { readonly line: number; readonly character: number };
}

/** Starts `ask.spec`, asks for the hover and the definition, prints both, and stops it. */
export async function askServer(ask: Ask): Promise<void> {
  const server = startServer(ask.spec);
  try {
    if (!(await server.ready))
      throw new Error(`${ask.spec.name} didn't start (${server.state.kind})`);
    const text = await readFile(join(ask.spec.root, ...ask.file.split('/')), 'utf8');
    server.open(ask.file, ask.languageId, text);
    for (const method of ['textDocument/hover', 'textDocument/definition'] as const) {
      const answer = await server.request(
        method,
        { path: ask.file, position: ask.position },
        { deadline: 120_000 },
      );
      console.log(`${method}: ${JSON.stringify(answer, null, 2)}`);
    }
  } finally {
    await server.stop();
    const log = server.log.slice(-20);
    if (log.length > 0) console.log(`The last of its log:\n${log.join('\n')}`);
  }
}
