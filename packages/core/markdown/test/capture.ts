// Captures GitHub's rendering of Markdown, for the tests to map from:
//
// - `constructs.html`: `constructs.md`, a document holding every construct Lo maps, rendered by
//   `POST /markdown` as GitHub renders comments in the test repository;
// - `snippets.json`: short Markdown snippets, each with GitHub's rendering, for the details where
//   GitHub's Markdown differs from CommonMark's: alerts, task lists, strikethrough, footnotes;
// - `posts.json`: the real posts of a few of the test repository's pull requests, each with its
//   Markdown and GitHub's rendering of it.
//
//   LO_FIXTURE_TOKEN_FILE=<file holding the bot's token> node packages/core/markdown/test/capture.ts
//
// It only reads: a GraphQL query, and `POST /markdown`, which renders without storing anything. It
// runs only as the test organization's bot, replaces the signatures in signed image addresses
// before anything is written, and refuses to write anything shaped like a token.

import { readFileSync, writeFileSync } from 'node:fs';

import { checkRecordingAccount, findToken, redactSignedUrls } from '@lo/testing';

const OWNER = 'rozed-dev';
const REPO = 'e2e';
/**
 * The pull requests whose posts are captured: review comments and reviews, one with an attached
 * image, and a description with a reference. The others' descriptions only say how the test
 * repository was set up, so only these pull requests' descriptions are captured.
 */
const PULL_REQUESTS = [23, 27, 74];
const DESCRIPTIONS = new Set([74]);
const API = 'https://api.github.com';
const FIXTURES = new URL('../../../../testing/fixtures/markdown/github/', import.meta.url);

const tokenFile = process.env['LO_FIXTURE_TOKEN_FILE'];
if (!tokenFile) {
  console.error("Set LO_FIXTURE_TOKEN_FILE to a file holding the bot's token.");
  process.exit(2);
}
const token = readFileSync(tokenFile, 'utf8').trim();
await checkRecordingAccount(fetch, token, API);

const headers = {
  authorization: `token ${token}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
};

/** Writes `text` to the fixture `name`, unless it holds a token. */
function write(name: string, text: string): void {
  const found = findToken(text, [token]);
  if (found) throw new Error(`${name} would hold ${found}; nothing was written`);
  writeFileSync(new URL(name, FIXTURES), text);
  console.log(`wrote ${name}`);
}

async function post(path: string, body: unknown): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to ${path}`);
  return response;
}

const constructs = readFileSync(new URL('constructs.md', FIXTURES), 'utf8');
const rendered = await post('/markdown', {
  text: constructs,
  mode: 'gfm',
  context: `${OWNER}/${REPO}`,
});
write('constructs.html', redactSignedUrls(await rendered.text()));

/** Snippets whose rendering Lo's own Markdown must match. */
const SNIPPETS = [
  '> [!note]\n> In lower case.',
  '> [!NOTE]\n>\n> After a blank line.',
  '> [!NOTE]  \n> After trailing spaces.',
  '>[!TIP]\n>Without a space.',
  '> [!TIP]\n> - A list in an alert.',
  '> [!NOTE]',
  '> [!NOTE] On the same line.',
  '- > [!TIP]\n  > In a list.',
  '> > [!WARNING]\n> > Nested.',
  '> [!DANGER]\n> Not a type.',
  '~a~ ~~b~~ ~~~c~~~ ~d~~ ~~e~ a~b~c',
  '~~*a* ~b~~ and ~x\ny~',
  'x[^A] y[^a] z[^b]\n\n[^a]: Lower case.\n[^B]: Upper case.\n[^unused]: Never shown.',
  'Text[^1] and[^1] again.\n\n[^1]: A note with **strong** text.\n\n    And a second paragraph.',
  '- [ ]\n- [x]\n- [ ] \n- [ ] Open\n- [x] Done\n  - [X] Nested',
  '1. [ ] Numbered\n2. Plain',
  '- [ ] Loose\n\n- [x] Task\n\n  Second paragraph.',
  '- [ ] **Strong** first',
  '# Hi\n\n## Hi\n\n### `x` & Ü!\n\n[to the second](#hi-1)',
  'a\nb  \nc\\\nd',
  '**strong** *em* `code` [link](https://example.com)',
  '| a | b |\n|:-|-:|\n| 1 | **2** |',
  '3. three\n4. four\n\n- loose\n\n- list',
  'www.example.com and https://example.com/a.',
  '```ts\nconst x = 1;\n```',
  '@rozed-bot, hi.',
];

const snippets: { markdown: string; html: string }[] = [];
for (const markdown of SNIPPETS) {
  const html = await post('/markdown', {
    text: markdown,
    mode: 'gfm',
    context: `${OWNER}/${REPO}`,
  });
  snippets.push({ markdown, html: redactSignedUrls(await html.text()) });
}
write('snippets.json', `${JSON.stringify({ snippets }, null, 2)}\n`);

const QUERY = `query Posts($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url
      body
      bodyHTML
      comments(first: 100) { nodes { url body bodyHTML } }
      reviews(first: 100) {
        nodes { url body bodyHTML comments(first: 100) { nodes { url body bodyHTML } } }
      }
    }
  }
}`;

interface Rendered {
  url: string;
  body: string;
  bodyHTML: string;
}

function isRendered(value: unknown): value is Rendered {
  return (
    typeof value === 'object' &&
    value !== null &&
    'url' in value &&
    'body' in value &&
    'bodyHTML' in value &&
    typeof value.url === 'string' &&
    typeof value.body === 'string' &&
    typeof value.bodyHTML === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The pull request in a query's answer. */
function pullRequestIn(json: unknown): Record<string, unknown> | undefined {
  let value: unknown = json;
  for (const key of ['data', 'repository', 'pullRequest'])
    value = isRecord(value) ? value[key] : undefined;
  return isRecord(value) ? value : undefined;
}

/** Every rendered post in `value`, at any depth, in order. */
function postsIn(value: unknown, found: Rendered[] = []): Rendered[] {
  if (isRendered(value) && value.body.trim() !== '') found.push(value);
  if (Array.isArray(value)) for (const item of value) postsIn(item, found);
  else if (typeof value === 'object' && value !== null) {
    for (const field of Object.values(value)) postsIn(field, found);
  }
  return found;
}

const captured: { source: string; markdown: string; html: string }[] = [];
for (const number of PULL_REQUESTS) {
  const response = await post('/graphql', {
    query: QUERY,
    variables: { owner: OWNER, name: REPO, number },
  });
  const json: unknown = await response.json();
  const pull = pullRequestIn(json);
  const posts = DESCRIPTIONS.has(number)
    ? postsIn(pull)
    : postsIn([pull?.['comments'], pull?.['reviews']]);
  for (const found of posts) {
    captured.push({
      source: found.url,
      markdown: redactSignedUrls(found.body),
      html: redactSignedUrls(found.bodyHTML),
    });
  }
}
write('posts.json', `${JSON.stringify({ posts: captured }, null, 2)}\n`);
