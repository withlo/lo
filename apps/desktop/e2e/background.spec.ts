import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { ElectronApplication } from '@playwright/test';

import { expect, test } from './app.ts';
import { catchPorts, portCount, run } from './ports.ts';

const backgroundPid = (app: ElectronApplication) =>
  app.evaluate(
    (electron) =>
      electron.app.getAppMetrics().find((metric) => metric.name === 'Lo background')?.pid,
  );

test.describe('with the test jobs', () => {
  test.use({ launch: { env: { LO_TEST_JOBS: '1' } } });

  test('a job answers through the port main hands the window, the process refuses malformed messages and keeps going, and a runaway job, or one past its share of the heap, is stopped', async ({
    app,
    page,
  }) => {
    test.setTimeout(90_000);
    await catchPorts(app, page);

    await test.step('a job answers through the port main hands the window', async () => {
      expect(await run(page, 0, { id: 1, job: 'test.spin', input: { ms: 10 } })).toEqual({
        id: 1,
        ok: true,
        value: 10,
      });
    });

    await test.step('the process refuses malformed messages and keeps going', async () => {
      expect(await run(page, 0, { id: 2, job: 'test.spin', input: { ms: 'long' } })).toMatchObject({
        id: 2,
        ok: false,
        error: { code: 'invalid' },
      });
      expect(await run(page, 0, { id: 3, job: 'test.nothing' })).toMatchObject({
        id: 3,
        ok: false,
        error: { code: 'unavailable' },
      });
      await page.evaluate(() =>
        window.backgroundPorts?.send(0, { job: 'test.spin', input: { ms: 1 } }),
      );
      expect(await run(page, 0, { id: 4, job: 'test.spin', input: { ms: 1 } })).toEqual({
        id: 4,
        ok: true,
        value: 1,
      });
    });

    await test.step('a job runs through the window’s own connection, input a port would drop is refused, and many jobs at once wait their turn', async () => {
      await expect.poll(() => page.evaluate(() => window.loBackground !== undefined)).toBe(true);
      expect(await page.evaluate(() => window.loBackground?.run('test.spin', { ms: 10 }))).toBe(10);
      expect(
        await page.evaluate(() =>
          window.loBackground?.run('test.spin', new Blob(['10'])).then(
            () => 'ran',
            (error: unknown) => (error instanceof Error && 'code' in error ? error.code : 'thrown'),
          ),
        ),
      ).toBe('invalid');

      // Three jobs per core, each half its deadline: they run a core's worth at a time, so they take
      // three times as long as one, and none runs out of time waiting.
      const cores = await app.evaluate(() =>
        process.getBuiltinModule('node:os').availableParallelism(),
      );
      const { answers, seconds } = await page.evaluate(async (count) => {
        const started = performance.now();
        const results = await Promise.all(
          Array.from({ length: count }, async () =>
            window.loBackground?.run('test.spin', { ms: 500 }),
          ),
        );
        return { answers: results, seconds: (performance.now() - started) / 1000 };
      }, cores * 3);
      expect(answers).toEqual(Array.from({ length: cores * 3 }, () => 500));
      expect(seconds).toBeGreaterThan(1.4);
    });

    await test.step('a runaway job is stopped at its deadline', async () => {
      expect(await run(page, 0, { id: 5, job: 'test.spin', input: { ms: 20_000 } })).toEqual({
        id: 5,
        ok: false,
        error: { code: 'timeout', message: 'test.spin ran past its 1000 ms.' },
      });
      expect(await run(page, 0, { id: 6, job: 'test.spin', input: { ms: 1 } })).toMatchObject({
        ok: true,
      });
    });

    await test.step('a job past its share of the heap is stopped', async () => {
      expect(
        await run(page, 0, {
          id: 7,
          job: 'test.allocate',
          input: { mb: 512, where: 'heap', holdMs: 0 },
        }),
      ).toEqual({
        id: 7,
        ok: false,
        error: { code: 'memory', message: 'test.allocate ran out of its 64 MB.' },
      });
      expect(await run(page, 0, { id: 8, job: 'test.spin', input: { ms: 1 } })).toMatchObject({
        ok: true,
      });
    });
  });
});

/** The background process's environment, read from outside it, as the system reports it. */
async function backgroundEnvironment(app: ElectronApplication): Promise<string> {
  await expect.poll(() => backgroundPid(app)).toBeDefined();
  const pid = await backgroundPid(app);
  if (process.platform === 'linux') {
    return (await readFile(`/proc/${pid}/environ`, 'utf8')).replaceAll('\0', '\n');
  }
  const { stdout } = await promisify(execFile)('ps', ['eww', '-o', 'command=', '-p', String(pid)]);
  return stdout;
}

test.describe('with a token in main’s environment', () => {
  test.use({ launch: { env: { GITHUB_TOKEN: 'hunter2', LO_TEST_JOBS: '' } } });

  test('the process gets none of it', async ({ app, page }) => {
    await page.waitForLoadState('load');
    const environment = await backgroundEnvironment(app);
    // The marker shows this is the process's environment, and nothing of main's came with it.
    expect(environment).toContain('LO_BACKGROUND=1');
    expect(environment).not.toContain('GITHUB_TOKEN');
    expect(environment).not.toContain('hunter2');
    expect(environment).not.toContain('LO_TEST_JOBS');
  });
});

test.describe('with a token in main’s environment and the test jobs', () => {
  test.use({ launch: { env: { GITHUB_TOKEN: 'hunter2', LO_TEST_JOBS: '1' } } });

  test('the process gets only the switch for the test jobs', async ({ app, page }) => {
    await page.waitForLoadState('load');
    const environment = await backgroundEnvironment(app);
    expect(environment).toContain('LO_TEST_JOBS=1');
    expect(environment).not.toContain('hunter2');
  });
});

test.describe('with a low memory cap', () => {
  test.use({ launch: { env: { LO_TEST_JOBS: '1', LO_BACKGROUND_MEMORY_CAP_MB: '200' } } });

  test('the window’s jobs fail as soon as the process is stopped, and run again after; and a process past its cap is restarted, and the window gets a new port', async ({
    app,
    page,
  }) => {
    test.setTimeout(90_000);

    await test.step('the window’s jobs fail as soon as the process is stopped, and run again after', async () => {
      await expect.poll(() => page.evaluate(() => window.loBackground !== undefined)).toBe(true);
      const outcome = await page.evaluate(async () => {
        // When the new port arrives, for comparison.
        const connected: number[] = [];
        window.addEventListener('message', (event: MessageEvent<{ state?: string }>) => {
          if (event.data.state === 'connected') connected.push(performance.now());
        });
        const code = await window.loBackground
          ?.run('test.allocate', { mb: 400, where: 'outside', holdMs: 30_000 })
          .then(
            () => 'answered',
            (error: unknown) => (error instanceof Error && 'code' in error ? error.code : 'thrown'),
          );
        const failedAt = performance.now();
        // The new port comes once the process is back.
        for (let waited = 0; connected.length === 0 && waited < 20_000; waited += 25) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return { code, failedAt, connectedAt: connected[0] };
      });
      expect(outcome.code).toBe('restarted');
      // The job failed when the process stopped, before the new port arrived.
      expect(outcome.connectedAt).toBeDefined();
      expect(outcome.failedAt).toBeLessThan(outcome.connectedAt ?? 0);
      expect(await page.evaluate(() => window.loBackground?.run('test.spin', { ms: 1 }))).toBe(1);
    });

    // The page loads again for this, with the ports caught from the process the first step left.
    await test.step('a process past its cap is restarted, and the window gets a new port', async () => {
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
});

test("the test jobs don't exist unless asked for", async ({ app, page }) => {
  await catchPorts(app, page);
  expect(await page.evaluate(() => window.loBackground)).toBe(undefined);
  expect(await run(page, 0, { id: 1, job: 'test.spin', input: { ms: 1 } })).toMatchObject({
    id: 1,
    ok: false,
    error: { code: 'unavailable' },
  });
});
