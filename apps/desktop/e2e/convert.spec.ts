// Converting a chain to a GitHub stack in the app: `g S` on a pull request's tab plans it in main,
// the dialog shows the steps to confirm, and main sends each change once, in order. It replays
// `app_stack_convert`, recorded from the app as it made #A, #B and #C GitHub stack #92 in
// rozed-dev/e2e, and, for what GitHub can't be made to do on demand, the same with an answer
// changed: a lost answer. What the dialog says of a refusal, and of a base branch changed
// elsewhere, is `Conversion.test.tsx`'s.

import {
  cassette,
  isObject,
  parseJson,
  Replay,
  toResponse,
  type Interaction,
  type SeenRequest,
} from '@lo/testing';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import type { NoteKind, StackState } from '../src/features/stacks/contract.ts';
import { expect, keysToDiff, onStacks, STACK } from './app.ts';

/** How GitHub answers, from `app_stack_convert`. */
type Answers =
  /** As recorded. */
  | 'recorded'
  /** Making the stack answers 502, and putting #C's base back goes through. */
  | 'lost';

const RETARGET = 'PATCH /repos/rozed-dev/e2e/pulls/';

/**
 * `app_stack_convert`'s answers, and from `app_stack`, what this cassette was recorded before Lo
 * read: GitHub's comparison of #C's head with #B's, since #C's diff starts at #B's head, and until
 * the local copy is ready it's that comparison; and #B's overview's commit, its tree and its files,
 * which the stack's tree reads for the stack overview it names. A comparison of two commits doesn't
 * change, and nor does what a commit holds.
 */
function convertAnswers(): Interaction[] {
  const recorded = cassette('app_stack_convert').interactions.map(({ interaction }) => interaction);
  const later = cassette('app_stack')
    .interactions.map(({ interaction }) => interaction)
    .filter(({ request }) => {
      const path = new URL(request.url).pathname;
      return (
        path.includes('/compare/') ||
        /\/git\/(trees|blobs)\/[0-9a-f]{40}$/.test(path) ||
        /\/commits\/[0-9a-f]{40}$/.test(path)
      );
    });
  return [...recorded, ...later];
}

/**
 * `app_stack_convert`, but #C as GitHub would have it: each read of it finds the base branch the
 * last change GitHub took gave it, however many reads came first, and making the stack answers
 * 502. Everything else answers as recorded.
 */
class Answering extends Replay {
  /** #C's address, and GitHub's answer to changing its base, as recorded. */
  readonly #pull: Interaction;
  #base = 'stack/root';

  constructor() {
    const recorded = convertAnswers();
    super('app_stack_convert, lost', recorded);
    const pull = recorded.find(({ request }) => request.method === 'PATCH');
    if (!pull) throw new Error('app_stack_convert changes no base branch');
    this.#pull = pull;
  }

  override answer(request: SeenRequest): Response {
    const { method, url } = request;
    const made = method === 'POST' && new URL(url).pathname.endsWith('/stacks');
    if (made) return this.#says(request, BAD_GATEWAY);
    if (url !== this.#pull.request.url) return super.answer(request);
    if (method === 'GET') return this.#says(request, this.#read());
    if (method !== 'PATCH') return super.answer(request);
    const sent = parseJson(new TextDecoder().decode(request.body));
    if (!isObject(sent) || typeof sent.base !== 'string') return super.answer(request);
    this.#base = sent.base;
    return this.#says(request, this.#read());
  }

  /** #C as a read finds it now: on `#base`, and never a `304`, for a change it can't have seen. */
  #read(): Interaction['response'] {
    const { headers, body } = this.#pull.response;
    if (!isObject(body) || !isObject(body.base)) throw new Error('not a pull request');
    return {
      status: 200,
      headers: { 'content-type': headers['content-type'] ?? 'application/json' },
      body: { ...body, base: { ...body.base, ref: this.#base } },
    };
  }

  #says(request: SeenRequest, response: Interaction['response']): Response {
    this.seen.push(request);
    return toResponse(response);
  }
}

/** GitHub's answer when its gateway gives up, whatever it did by then. */
const BAD_GATEWAY: Interaction['response'] = {
  status: 502,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: { message: 'Server Error' },
};

const test = onStacks.extend<{ answers: Answers }>({
  answers: ['recorded', { option: true }],
  github: async ({ answers }, use) => {
    const server = await serveReplay(
      answers === 'recorded' ? new Replay('app_stack_convert', convertAnswers()) : new Answering(),
    );
    await use(server);
    await server.close();
  },
});

/** What Lo wrote to GitHub, in order: each request but a read or a GraphQL query, and its body. */
function writes(github: ReplayServer): string[] {
  return github.replay.seen
    .filter(({ method, url }) => method !== 'GET' && new URL(url).pathname !== '/graphql')
    .map(({ method, url, body }) =>
      `${method} ${new URL(url).pathname} ${new TextDecoder().decode(body)}`.trimEnd(),
    );
}

/** Opens pull request `number`'s tab, and waits until main has read its stack's layers. */
async function open(page: Page, number: number): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    number,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  const id = reply.value;
  await expect.poll(() => stackOf(page, id), { timeout: 30_000 }).not.toBe('unread');
  return id;
}

/** Whether the stack tab `id` shows is one GitHub stack, and its notes, once its layers are read. */
async function stackOf(
  page: Page,
  id: string,
): Promise<{ githubStack: boolean; notes: NoteKind[] } | 'unread'> {
  const reply = await page.evaluate((tab) => window.lo.invoke('stacks.state', { id: tab }), id);
  if (!reply.ok) return 'unread';
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what the contract says.
  const stack = (reply.value as StackState | undefined)?.stack;
  if (stack?.kind !== 'stack') return 'unread';
  if (!stack.rows.every((row) => row.viewed)) return 'unread';
  return { githubStack: stack.githubStack, notes: stack.notes.map((note) => note.kind) };
}

/** Presses `g S`, "Convert to GitHub stack…", in the diff on screen, once it shows. */
async function makeStack(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.loDiff?.files.length ?? 0), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await keysToDiff(page);
  await page.keyboard.press('g');
  await page.keyboard.press('Shift+S');
}

const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** Opens #C, and confirms converting its chain to a GitHub stack. */
async function confirmOnC(page: Page): Promise<void> {
  await open(page, STACK.c);
  await makeStack(page);
  const dialog = page.getByTestId('make-stack');
  await expect(dialog.getByRole('list', { name: 'Steps' })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Enter');
}

const MADE = [
  `${RETARGET}${STACK.c} {"base":"stack/b"}`,
  `POST /repos/rozed-dev/e2e/stacks {"pull_requests":[${STACK.a},${STACK.b},${STACK.c}]}`,
];

test('converts a chain to a GitHub stack once the reader confirms it, and only then', async ({
  page,
  github,
}) => {
  test.setTimeout(120_000);
  // #A has two layers on it, #B and #D, so which to stack is the reader's to say.
  await open(page, STACK.a);
  await makeStack(page);
  await expect(said(page, `Show one of the layers above #${STACK.a} first`)).toHaveCount(1, {
    timeout: 20_000,
  });

  const c = await open(page, STACK.c);
  expect(await stackOf(page, c)).toEqual({ githubStack: false, notes: [] });
  await makeStack(page);
  const dialog = page.getByTestId('make-stack');
  const steps = dialog.getByRole('list', { name: 'Steps' });
  await expect(steps).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toContainText('Convert to GitHub stack?');
  await expect(dialog).toContainText('e2e · 3 layers');
  // Only what's sent: #A and #B already sit where they should.
  await expect(steps.getByRole('listitem')).toHaveText([
    new RegExp(`Move #${STACK.c} onto stack/b\\.\\s*From stack/root\\.$`),
    new RegExp(`Create the GitHub stack from #${STACK.a}, #${STACK.b} and #${STACK.c}\\.$`),
  ]);
  await expect(dialog).toContainText(
    'On GitHub, each moved pull request’s diff shows only its own commits.',
  );
  await expect(dialog).toContainText('rozed-bot');

  // Cancelling sends nothing.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(writes(github)).toEqual([]);

  await makeStack(page);
  await expect(steps).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('Converted to GitHub stack', {
    timeout: 30_000,
  });
  expect(writes(github)).toEqual(MADE);
  await dialog.getByRole('button', { name: /^Done/ }).click();
  await expect(dialog).toBeHidden();
  // #A, #B and #C are a GitHub stack now. One can't branch, so #D still sits on #A by its base
  // branch, and the tree says which layers are the GitHub stack.
  await expect
    .poll(() => stackOf(page, c), { timeout: 30_000 })
    .toEqual({ githubStack: false, notes: ['github'] });
  const stack = page.getByRole('region', { name: 'Stack' });
  // Only some layers are the GitHub stack: the head says it's a stack, of neither kind.
  await expect(stack).toContainText('Stack · 4 layers');
  await expect(stack.getByRole('note')).toContainText([
    `#${STACK.a}, #${STACK.b} and #${STACK.c} are a GitHub stack.`,
  ]);
  expect(writes(github)).toEqual(MADE);
});

test.describe('when GitHub’s answer is lost', () => {
  test.use({ answers: 'lost' });

  test('says the conversion isn’t confirmed, and undoes its changes once asked', async ({
    page,
    github,
  }) => {
    test.setTimeout(120_000);
    await confirmOnC(page);
    const dialog = page.getByTestId('make-stack');
    const problem = dialog.getByRole('alert');
    await expect(problem).toContainText('Conversion not confirmed', { timeout: 30_000 });
    await expect(problem).toContainText('GitHub didn’t respond.');
    await expect(dialog.getByRole('list', { name: 'Steps' })).toContainText('Not confirmed');
    // GitHub's page says whether it went.
    await expect(dialog.getByRole('button', { name: /^Open on GitHub/ })).toBeVisible();
    expect(writes(github)).toEqual(MADE);

    await dialog.getByRole('button', { name: /^Undo changes/ }).click();
    await expect(dialog.getByRole('status')).toHaveText('Changes undone', { timeout: 30_000 });
    await expect(dialog.getByRole('list', { name: 'Undo' })).toBeVisible();
    expect(writes(github)).toEqual([...MADE, `${RETARGET}${STACK.c} {"base":"stack/root"}`]);
  });
});
