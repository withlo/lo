import { readFileSync } from 'node:fs';

import { Kind, parse, print } from 'graphql';
import { expect, test } from 'vitest';

/** The `ReviewComment` fragment of the query in `graphql/<file>`, printed without comments. */
function fragment(file: string): string {
  const source = readFileSync(new URL(`../graphql/${file}`, import.meta.url), 'utf8');
  const found = parse(source).definitions.find(
    (definition) =>
      definition.kind === Kind.FRAGMENT_DEFINITION && definition.name.value === 'ReviewComment',
  );
  if (!found) throw new Error(`${file} has no ReviewComment fragment`);
  return print(found);
}

test('the comments queries select the same fields', () => {
  // A thread's later comments are added to the ones its first page held, so both queries must
  // read them alike.
  expect(fragment('review_threads.graphql')).toBe(fragment('review_thread_comments.graphql'));
});
