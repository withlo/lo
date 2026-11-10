// Every GraphQL query is valid against GitHub's vendored schema, as the GraphQL spec validates it:
// code generation checks fields, but not argument names or variable types, so a query GitHub would
// reject fails here instead. `scripts/update-github-schema.ts` runs these after a schema refresh.
// And every query a cassette recorded is one of these files, so no recording outlives its query.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cassette, fixturesDir, queryHash } from '@lo/testing';
import { buildSchema, Kind, parse, validate, type FieldNode, type SelectionSetNode } from 'graphql';
import { expect, test } from 'vitest';

import * as generated from '../src/generated/graphql.ts';

const dir = fileURLToPath(new URL('../graphql', import.meta.url));
const schema = buildSchema(readFileSync(join(dir, 'schema.graphql'), 'utf8'));
const queries = readdirSync(dir).filter(
  (file) => file.endsWith('.graphql') && file !== 'schema.graphql',
);

/** What's wrong with `source` against the schema, if anything. */
function problems(source: string): string[] {
  return validate(schema, parse(source)).map((error) => error.message);
}

test('graphql schema validates every query', () => {
  expect(queries.length).toBeGreaterThanOrEqual(41);
  const invalid = queries.flatMap((file) =>
    problems(readFileSync(join(dir, file), 'utf8')).map((message) => `${file}: ${message}`),
  );
  expect(invalid).toEqual([]);
});

test('graphql schema check catches what codegen misses', () => {
  const argumentTypo = `query Q($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) { pullRequest(numbr: $number) { title } }
  }`;
  expect(problems(argumentTypo).join('\n')).toContain('numbr');
  const wrongVariableType = `query Q($owner: String!, $name: String!, $number: String!) {
    repository(owner: $owner, name: $name) { pullRequest(number: $number) { title } }
  }`;
  expect(problems(wrongVariableType).join('\n')).toContain('$number');
});

test('graphql schema has stacks', () => {
  const pullRequest = schema.getType('PullRequest');
  expect(pullRequest && 'getFields' in pullRequest && 'stackEntry' in pullRequest.getFields()).toBe(
    true,
  );
  expect(schema.getType('PullRequestStack')).toBeDefined();
});

/** The field whose response key is `key`, anywhere in `set`. */
function find(set: SelectionSetNode | undefined, key: string): FieldNode | undefined {
  for (const selection of set?.selections ?? []) {
    if (selection.kind === Kind.FIELD) {
      if ((selection.alias ?? selection.name).value === key) return selection;
      const found = find(selection.selectionSet, key);
      if (found) return found;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const found = find(selection.selectionSet, key);
      if (found) return found;
    }
  }
  return undefined;
}

function operation(file: string): SelectionSetNode {
  const document = parse(readFileSync(join(dir, file), 'utf8'));
  const definition = document.definitions.find((node) => node.kind === Kind.OPERATION_DEFINITION);
  if (!definition) throw new Error(`${file} has no operation`);
  return definition.selectionSet;
}

/** The `itemTypes` the field `key` of `file`'s one operation asks for. */
function itemTypes(file: string, key: string): string[] {
  const argument = find(operation(file), key)?.arguments?.find(
    ({ name }) => name.value === 'itemTypes',
  );
  if (argument?.value.kind !== Kind.LIST) throw new Error(`${file}'s itemTypes isn't a list`);
  return argument.value.values
    .map((value) => (value.kind === Kind.ENUM ? value.value : `not an item type: ${value.kind}`))
    .toSorted();
}

/** `HeadRefForcePushedEvent`'s item type, `HEAD_REF_FORCE_PUSHED_EVENT`. */
function itemType(typename: string): string {
  return typename.replace(/(?!^)([A-Z])/g, '_$1').toUpperCase();
}

test('the check watches the item types the timeline reads', () => {
  const node = find(operation('timeline.graphql'), 'node');
  const read = (node?.selectionSet?.selections ?? [])
    .flatMap((selection) =>
      selection.kind === Kind.INLINE_FRAGMENT && selection.typeCondition
        ? [itemType(selection.typeCondition.name.value)]
        : [],
    )
    .toSorted();
  expect(itemType('HeadRefForcePushedEvent')).toBe('HEAD_REF_FORCE_PUSHED_EVENT');
  expect(read.length).toBeGreaterThan(20);
  const known = schema.getType('PullRequestTimelineItemsItemType');
  const values = known && 'getValues' in known ? known.getValues().map(({ name }) => name) : [];
  expect(read.filter((name) => !values.includes(name))).toEqual([]);
  expect(itemTypes('pull_request_check.graphql', 'timelineEvents')).toEqual(read);
  expect(itemTypes('timeline.graphql', 'timelineEvents')).toEqual(read);
});

test('every query a cassette recorded is one of the query files', () => {
  const hashes = new Map(
    queries.map((file) => [queryHash(readFileSync(join(dir, file), 'utf8')), file]),
  );
  const stale: string[] = [];
  let recorded = 0;
  for (const name of readdirSync(fixturesDir)) {
    for (const { file, interaction } of cassette(name).interactions) {
      const hash = interaction.request.query_sha256;
      if (hash === undefined) continue;
      recorded += 1;
      if (!hashes.has(hash)) stale.push(`${name}/${file}: ${interaction.request.operation ?? ''}`);
    }
  }
  expect(recorded).toBeGreaterThan(100);
  expect(stale).toEqual([]);
});

test('the client sends each query as its file has it', () => {
  const documents = Object.entries(generated).filter(([name]) => name.endsWith('Document'));
  expect(documents).toHaveLength(queries.length);
  const files = new Set(queries.map((file) => queryHash(readFileSync(join(dir, file), 'utf8'))));
  const differing = documents.filter(([, document]) => !files.has(queryHash(String(document))));
  expect(differing.map(([name]) => name)).toEqual([]);
});
