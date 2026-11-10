import type { ElectronApplication, Page } from '@playwright/test';

import { expect, test } from './app.ts';

/** The page's own hold on each port main hands the window, and a way to run jobs on them. */
interface Ports {
  ports: MessagePort[];
  send(port: number, message: unknown): void;
  /** Sends a job and waits for its answer, or says there was none within `wait` ms. */
  run(
    port: number,
    request: { id: number; job: string; input?: unknown },
    wait?: number,
  ): Promise<unknown>;
}

declare global {
  interface Window {
    backgroundPorts?: Ports;
  }
}

/**
 * Loads the page again with a listener that keeps each port main hands over, beside the window's
 * own, so the test can talk to the background process the way the window does.
 */
async function catchPorts(app: ElectronApplication, page: Page): Promise<void> {
  await app.context().addInitScript(() => {
    const ports: MessagePort[] = [];
    window.addEventListener('message', (event) => {
      const [port] = event.ports;
      if (event.source !== window || event.data !== 'lo:background' || !port) return;
      port.start();
      ports.push(port);
    });
    window.backgroundPorts = {
      ports,
      send: (index, message) => ports[index]?.postMessage(message),
      run: (index, request, wait = 10_000) =>
        new Promise((resolve) => {
          const port = ports[index];
          const timer = setTimeout(() => resolve('no answer'), wait);
          port?.addEventListener('message', (event: MessageEvent<{ id?: number }>) => {
            if (event.data.id !== request.id) return;
            clearTimeout(timer);
            resolve(event.data);
          });
          port?.postMessage(request);
        }),
    };
  });
  await page.reload();
  await expect.poll(() => portCount(page)).toBe(1);
}

const portCount = (page: Page) => page.evaluate(() => window.backgroundPorts?.ports.length);

function run(page: Page, port: number, request: { id: number; job: string; input?: unknown }) {
  return page.evaluate(([index, job]) => window.backgroundPorts?.run(index, job), [
    port,
    request,
  ] as const);
}

const backgroundPid = (app: ElectronApplication) =>
  app.evaluate(
    (electron) =>
      electron.app.getAppMetrics().find((metric) => metric.name === 'Lo background')?.pid,
  );

test.describe('with the test jobs', () => {
  test.use({ launch: { env: { LO_TEST_JOBS: '1' } } });

  test('a job answers through the port main hands the window', async ({ app, page }) => {
    await catchPorts(app, page);
    expect(await run(page, 0, { id: 1, job: 'test.spin', input: { ms: 10 } })).toEqual({
      id: 1,
      ok: true,
      value: 10,
    });
  });

  test('the process refuses malformed messages and keeps going', async ({ app, page }) => {
    await catchPorts(app, page);
    expect(await run(page, 0, { id: 1, job: 'test.spin', input: { ms: 'long' } })).toMatchObject({
      id: 1,
      ok: false,
      error: { code: 'invalid' },
    });
    expect(await run(page, 0, { id: 2, job: 'test.nothing' })).toMatchObject({
      id: 2,
      ok: false,
      error: { code: 'unavailable' },
    });
    await page.evaluate(() =>
      window.backgroundPorts?.send(0, { job: 'test.spin', input: { ms: 1 } }),
    );
    expect(await run(page, 0, { id: 3, job: 'test.spin', input: { ms: 1 } })).toEqual({
      id: 3,
      ok: true,
      value: 1,
    });
  });

  test('a runaway job is stopped at its deadline', async ({ app, page }) => {
    await catchPorts(app, page);
    expect(await run(page, 0, { id: 1, job: 'test.spin', input: { ms: 20_000 } })).toEqual({
      id: 1,
      ok: false,
      error: { code: 'timeout', message: 'test.spin ran past its 1000 ms.' },
    });
    expect(await run(page, 0, { id: 2, job: 'test.spin', input: { ms: 1 } })).toMatchObject({
      ok: true,
    });
  });

  test('a job past its share of the heap is stopped', async ({ app, page }) => {
    await catchPorts(app, page);
    expect(
      await run(page, 0, {
        id: 1,
        job: 'test.allocate',
        input: { mb: 512, where: 'heap', holdMs: 0 },
      }),
    ).toEqual({
      id: 1,
      ok: false,
      error: { code: 'memory', message: 'test.allocate ran out of its 64 MB.' },
    });
    expect(await run(page, 0, { id: 2, job: 'test.spin', input: { ms: 1 } })).toMatchObject({
      ok: true,
    });
  });
});

test.describe('with a token in the environment', () => {
  test.use({ launch: { env: { LO_TEST_JOBS: '1', GITHUB_TOKEN: 'hunter2' } } });

  test("the process doesn't get main's environment", async ({ app, page }) => {
    await catchPorts(app, page);
    const reply = await run(page, 0, { id: 1, job: 'test.environment' });
    expect(reply).toMatchObject({ id: 1, ok: true });
    expect(JSON.stringify(reply)).not.toContain('GITHUB_TOKEN');
  });
});

test.describe('with a low memory cap', () => {
  test.use({ launch: { env: { LO_TEST_JOBS: '1', LO_BACKGROUND_MEMORY_CAP_MB: '200' } } });

  test('a process past its cap is restarted, and the window gets a new port', async ({
    app,
    page,
  }) => {
    await catchPorts(app, page);
    const before = await backgroundPid(app);
    // Memory outside the heap, as WebAssembly's is, which only the cap on the process catches.
    await page.evaluate(() =>
      window.backgroundPorts?.send(0, {
        id: 1,
        job: 'test.allocate',
        input: { mb: 400, where: 'outside', holdMs: 30_000 },
      }),
    );
    await expect.poll(() => portCount(page), { timeout: 15_000 }).toBe(2);
    const after = await backgroundPid(app);
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect(await run(page, 1, { id: 2, job: 'test.spin', input: { ms: 1 } })).toEqual({
      id: 2,
      ok: true,
      value: 1,
    });
  });
});

test("the test jobs don't exist unless asked for", async ({ app, page }) => {
  await catchPorts(app, page);
  expect(await run(page, 0, { id: 1, job: 'test.spin', input: { ms: 1 } })).toMatchObject({
    id: 1,
    ok: false,
    error: { code: 'unavailable' },
  });
});
