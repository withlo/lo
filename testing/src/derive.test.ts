import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { cassetteDir, fixturesDir, readCassette, type Interaction } from './cassette.ts';
import { DERIVATIONS } from './derivations.ts';
import {
  answered,
  BAD_GATEWAY,
  derivedFiles,
  graphql,
  only,
  refused,
  writeDerived,
} from './derive.ts';
import { Replay } from './replay.ts';
import { addAnswers } from './rerecord.ts';

const user: Interaction = {
  request: { method: 'GET', url: 'https://api.github.com/user' },
  response: { status: 200, headers: {}, body: { login: 'rozed-bot' } },
};

const posted: Interaction = {
  request: {
    method: 'POST',
    url: 'https://api.github.com/graphql',
    operation: 'AddComment',
    variables: { body: 'Hi' },
  },
  response: {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { data: { addComment: { id: 'C_1' } } },
  },
};

/** A folder of cassettes, removed when the test ends, holding `recorded`, as recorded. */
function fixtures(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lo-derive-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const recorded = join(dir, 'recorded');
  mkdirSync(recorded);
  writeFileSync(join(recorded, 'cassette.json'), JSON.stringify({ description: 'recorded' }));
  writeFileSync(join(recorded, '001-GET-user.json'), JSON.stringify(user));
  writeFileSync(join(recorded, '002-POST-graphql-AddComment.json'), JSON.stringify(posted));
  return dir;
}

test('a derived cassette holds only what it changes, by number, and what it adds after', () => {
  const recorded = [
    { file: '001-GET-user.json', interaction: user },
    { file: '002-POST-graphql-AddComment.json', interaction: posted },
  ];
  const lost = answered(posted, BAD_GATEWAY);
  expect(derivedFiles(recorded, [user, lost, user]).map(({ file }) => file)).toEqual([
    '002-POST-graphql-AddComment.json',
    '003-GET-user.json',
  ]);
  expect(() => derivedFiles(recorded, [user])).toThrow('leaves out 1');
});

test('read, a derived cassette is the recorded one with its answers in place, and the replayer answers from it', async () => {
  const dir = fixtures();
  const files = writeDerived(
    {
      name: 'derived',
      from: 'recorded',
      description: 'refused',
      derive(interactions) {
        const place = only(interactions, graphql('AddComment'), 'comments');
        interactions[place] = answered(
          interactions[place]!,
          refused(interactions[place]!, 'was submitted too quickly'),
        );
        return [...interactions, answered(posted, BAD_GATEWAY)];
      },
    },
    dir,
  );
  expect(files).toEqual([
    'cassette.json',
    '002-POST-graphql-AddComment.json',
    '003-POST-graphql-AddComment.json',
  ]);
  expect(JSON.parse(readFileSync(join(dir, 'derived', 'cassette.json'), 'utf8'))).toEqual({
    description: 'refused',
    derived_from: 'recorded',
  });
  const derived = readCassette(join(dir, 'derived'));
  expect(derived.interactions.map(({ interaction }) => interaction.response.status)).toEqual([
    200, 200, 502,
  ]);
  const replay = Replay.fromDir(join(dir, 'derived'));
  const ask = () =>
    replay.respond(
      new Request('https://api.github.com/graphql', {
        method: 'POST',
        body: JSON.stringify({
          query: 'mutation AddComment { x }',
          operationName: 'AddComment',
          variables: { body: 'Hi' },
        }),
      }),
    );
  await expect((await ask()).json()).resolves.toMatchObject({
    data: { addComment: null },
    errors: [{ type: 'UNPROCESSABLE', message: 'was submitted too quickly' }],
  });
  expect((await ask()).status).toBe(502);
  // Answers aren't added to a derived cassette in place: it's written again from its recording.
  await expect(
    addAnswers({
      fetch,
      token: 'unused',
      query: 'query Viewer { viewer { login } }',
      variables: [null],
      dirs: [join(dir, 'derived')],
      at: '2026-11-14T00:00:00Z',
    }),
  ).rejects.toThrow('is derived from recorded');
});

/** The text of each of `files` in `folder`, by name. */
function texts(folder: string, files: readonly string[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file, readFileSync(join(folder, file), 'utf8')]));
}

test('every derived cassette is as its derivation writes it from its recording now', () => {
  for (const derivation of DERIVATIONS) {
    const dir = mkdtempSync(join(tmpdir(), 'lo-derived-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    // Its recording as committed, whole, even where that's derived in turn.
    const from = readCassette(cassetteDir(derivation.from));
    mkdirSync(join(dir, derivation.from));
    const info = { ...from.info, derived_from: undefined };
    writeFileSync(join(dir, derivation.from, 'cassette.json'), JSON.stringify(info));
    for (const { file, interaction } of from.interactions) {
      writeFileSync(join(dir, derivation.from, file), JSON.stringify(interaction));
    }
    const written = writeDerived(derivation, dir);
    const committed = join(fixturesDir, derivation.name);
    expect(
      texts(join(dir, derivation.name), written),
      `run node testing/scripts/derive-answers.ts ${derivation.name}`,
    ).toEqual(texts(committed, readdirSync(committed)));
  }
});
