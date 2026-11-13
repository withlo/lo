// Making a chain a GitHub stack in the app: `g S` on a pull request's tab plans it in main, the
// dialog shows the plan to confirm, and main sends each change once, in order. It replays
// `app_stack_convert`, recorded from the app as it made #A, #B and #C GitHub stack #91 in
// rozed-dev/e2e, and, for what GitHub can't be made to do on demand, the same with an answer
// changed: a lost answer, a refusal, and a base branch changed elsewhere.

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

import type { StackState } from '../src/features/stacks/contract.ts';
import { expect, onStacks, STACK } from './app.ts';

/** How GitHub answers, from `app_stack_convert`. */
type Answers =
  /** As recorded. */
  | 'recorded'
  /** Making the stack answers 502, and putting #C's base back goes through. */
  | 'lost'
  /** GitHub refuses to change #C's base. */
  | 'refused'
  /** Making the stack answers 502, and #C's base is changed elsewhere once Lo changed it. */
  | 'moved';

const RETARGET = 'PATCH /repos/rozed-dev/e2e/pulls/';

/**
 * `app_stack_convert`'s answers, and GitHub's comparison of #C's head with #B's, from `app_stack`:
 * #C's diff starts at #B's head, and until the local copy is ready it's that comparison, which this
 * cassette was recorded before Lo read. A comparison of two commits doesn't change.
 */
function convertAnswers(): Interaction[] {
  const recorded = cassette('app_stack_convert').interactions.map(({ interaction }) => interaction);
  const compared = cassette('app_stack')
    .interactions.map(({ interaction }) => interaction)
    .filter(({ request }) => new URL(request.url).pathname.includes('/compare/'));
  return [...recorded, ...compared];
}

/**
 * `app_stack_convert`, but #C as GitHub would have it: each read of it finds the base branch the
 * last change GitHub took gave it, however many reads came first, and making the stack, or
 * changing #C's base, answers as `answers` says. Everything else answers as recorded.
 */
class Answering extends Replay {
  readonly #answers: Answers;
  /** #C's address, and GitHub's answer to changing its base, as recorded. */
  readonly #pull: Interaction;
  #base = 'stack/root';

  constructor(answers: Answers) {
    const recorded = convertAnswers();
    super(`app_stack_convert, ${answers}`, recorded);
    const pull = recorded.find(({ request }) => request.method === 'PATCH');
    if (!pull) throw new Error('app_stack_convert changes no base branch');
    this.#answers = answers;
    this.#pull = pull;
  }

  override answer(request: SeenRequest): Response {
    const { method, url } = request;
    const made = method === 'POST' && new URL(url).pathname.endsWith('/stacks');
    if (made && this.#answers !== 'refused') return this.#says(request, BAD_GATEWAY);
    if (url !== this.#pull.request.url) return super.answer(request);
    if (method === 'GET') return this.#says(request, this.#read());
    if (method !== 'PATCH') return super.answer(request);
    if (this.#answers === 'refused') return this.#says(request, REFUSED);
    const sent = parseJson(new TextDecoder().decode(request.body));
    if (!isObject(sent) || typeof sent.base !== 'string') return super.answer(request);
    this.#base = sent.base;
    const answer = this.#read();
    if (this.#answers === 'moved') this.#base = 'stack/x';
    return this.#says(request, answer);
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

/** GitHub's refusal to change #C's base branch. */
const REFUSED: Interaction['response'] = {
  status: 422,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: {
    message: 'Validation Failed',
    errors: [
      {
        resource: 'PullRequest',
        field: 'base',
        code: 'invalid',
        message: "Proposed base branch 'stack/b' was not found",
      },
    ],
  },
};

const test = onStacks.extend<{ answers: Answers }>({
  answers: ['recorded', { option: true }],
  github: async ({ answers }, use) => {
    const server = await serveReplay(
      answers === 'recorded'
        ? new Replay('app_stack_convert', convertAnswers())
        : new Answering(answers),
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
  await expect.poll(() => headOf(page, id), { timeout: 30_000 }).not.toBe('unread');
  return id;
}

/** The head of the stack tab `id` shows, once main has read the state of its layers. */
async function headOf(page: Page, id: string): Promise<string> {
  const reply = await page.evaluate((tab) => window.lo.invoke('stacks.state', { id: tab }), id);
  if (!reply.ok) return 'unread';
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what the contract says.
  const stack = (reply.value as StackState | undefined)?.stack;
  if (stack?.kind !== 'stack') return 'unread';
  return stack.rows.every((row) => row.viewed) ? stack.head : 'unread';
}

/** Presses `g S`, "Make this a GitHub stack", in the diff on screen, once it shows. */
async function makeStack(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.loDiff?.files.length ?? 0), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.locator('.lo-diffview').click();
  await page.keyboard.press('g');
  await page.keyboard.press('Shift+S');
}

const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** Opens #C, and confirms making its chain a GitHub stack. */
async function confirmOnC(page: Page): Promise<void> {
  await open(page, STACK.c);
  await makeStack(page);
  const dialog = page.getByTestId('make-stack');
  await expect(dialog).toContainText('Make these 3 PRs a GitHub stack?', { timeout: 20_000 });
  await page.keyboard.press('Enter');
}

const MADE = [
  `${RETARGET}${STACK.c} {"base":"stack/b"}`,
  `POST /repos/rozed-dev/e2e/stacks {"pull_requests":[${STACK.a},${STACK.b},${STACK.c}]}`,
];

test('makes a chain a GitHub stack once the reader confirms it, and only then', async ({
  page,
  github,
}) => {
  test.setTimeout(120_000);
  // #A has two layers on it, #B and #D, so which to stack is the reader's to say.
  await open(page, STACK.a);
  await makeStack(page);
  await expect(said(page, `#${STACK.a} has 2 layers on it.`)).toHaveCount(1, { timeout: 20_000 });

  const c = await open(page, STACK.c);
  expect(await headOf(page, c)).toBe('4 layers · by base branch and shared commits');
  await makeStack(page);
  const dialog = page.getByTestId('make-stack');
  await expect(dialog).toContainText('Make these 3 PRs a GitHub stack?', { timeout: 20_000 });
  await expect(dialog).toContainText('1 · One base branch changes');
  await expect(dialog.getByRole('row')).toHaveText([
    new RegExp(`^#${STACK.a}\\s*Stack A: load per-plan limits\\s*stack/root\\s*no change$`),
    new RegExp(`^#${STACK.b}.*stack/a\\s*no change$`),
    new RegExp(`^#${STACK.c}\\s*Stack C: count a query's nodes\\s*stack/root → stack/b$`),
  ]);
  await expect(dialog).toContainText(`#${STACK.a} → #${STACK.b} → #${STACK.c}, through GitHub's`);
  await expect(dialog).toContainText(
    `Base branches change for everyone, on GitHub too. rozed-bot will see #${STACK.c}'s diff shrink`,
  );
  await expect(dialog).toContainText('as rozed-bot');

  // Cancelling sends nothing.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(writes(github)).toEqual([]);

  await makeStack(page);
  await expect(dialog).toContainText('Make the stack', { timeout: 20_000 });
  await page.keyboard.press('Enter');
  await expect(
    said(page, `Made #${STACK.a}, #${STACK.b} and #${STACK.c} a GitHub stack`),
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(dialog).toBeHidden();
  expect(writes(github)).toEqual(MADE);
  // #C's base branch is now #B's head, so #A, #B and #C sit on each other by base branch alone.
  await expect.poll(() => headOf(page, c), { timeout: 30_000 }).toBe('4 layers · by base branch');
  expect(writes(github)).toEqual(MADE);
});

onStacks.describe('as nobody', () => {
  onStacks.use({ cassette: 'app_stack_nobody', account: false });

  onStacks('refuses before asking GitHub anything', async ({ page, github }) => {
    const reply = await page.evaluate(
      (pr) =>
        window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
      STACK.c,
    );
    expect(reply.ok).toBe(true);
    await expect(page.getByText("Stack C: count a query's nodes").first()).toBeVisible({
      timeout: 20_000,
    });
    await makeStack(page);
    await expect(said(page, 'Sign in to change base branches.')).toHaveCount(1, {
      timeout: 20_000,
    });
    expect(github.replay.seen.filter(({ url }) => url.includes('/stacks'))).toEqual([]);
    expect(writes(github)).toEqual([]);
  });
});

test.describe('when GitHub’s answer is lost', () => {
  test.use({ answers: 'lost' });

  test('says what may have changed, and puts the base branch back once asked', async ({
    page,
    github,
  }) => {
    test.setTimeout(120_000);
    await confirmOnC(page);
    const dialog = page.getByTestId('make-stack');
    await expect(dialog).toContainText("The stack wasn't created", { timeout: 30_000 });
    await expect(dialog).toContainText(
      "GitHub's answer was lost, so it may have been created. One base branch had already changed.",
    );
    await expect(dialog).toContainText('It may have gone through.');
    await expect(dialog).toContainText(
      'GitHub may have made the stack before its answer was lost.',
    );
    expect(writes(github)).toEqual(MADE);

    await page.keyboard.press('Enter');
    await expect(dialog).toContainText('The base branch is back', { timeout: 30_000 });
    expect(writes(github)).toEqual([...MADE, `${RETARGET}${STACK.c} {"base":"stack/root"}`]);
  });
});

test.describe('when GitHub refuses a change', () => {
  test.use({ answers: 'refused' });

  test('stops there, and sends nothing after it', async ({ page, github }) => {
    test.setTimeout(120_000);
    await confirmOnC(page);
    const dialog = page.getByTestId('make-stack');
    await expect(dialog).toContainText("The stack wasn't created", { timeout: 30_000 });
    await expect(dialog).toContainText('No base branch had changed.');
    await expect(dialog).toContainText("Proposed base branch 'stack/b' was not found");
    await expect(dialog).toContainText('Not sent.');
    await expect(dialog.getByRole('button', { name: /Put the base/ })).toHaveCount(0);
    expect(writes(github)).toEqual([MADE[0]]);
  });
});

test.describe('when a base branch changes elsewhere', () => {
  test.use({ answers: 'moved' });

  test('leaves it as it is while putting back, and says so', async ({ page, github }) => {
    test.setTimeout(120_000);
    await confirmOnC(page);
    const dialog = page.getByTestId('make-stack');
    await expect(dialog).toContainText("The stack wasn't created", { timeout: 30_000 });
    await page.keyboard.press('Enter');
    await expect(dialog).toContainText('Not everything was put back', { timeout: 30_000 });
    await expect(dialog).toContainText('Its base is now stack/x. Lo left it.');
    expect(writes(github)).toEqual(MADE);
  });
});
