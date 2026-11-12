// The background process's ports, as the window has them: a test catches each port main hands the
// page, beside the window's own hold on it, and runs jobs on it as the window does.

import type { ElectronApplication, Page } from '@playwright/test';

import { expect } from './app.ts';

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
export async function catchPorts(app: ElectronApplication, page: Page): Promise<void> {
  await app.context().addInitScript(() => {
    const ports: MessagePort[] = [];
    window.addEventListener('message', (event: MessageEvent<{ type?: string; state?: string }>) => {
      const [port] = event.ports;
      const connected = event.data.type === 'lo:background' && event.data.state === 'connected';
      if (event.source !== window || !connected || !port) return;
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

export const portCount = (page: Page) => page.evaluate(() => window.backgroundPorts?.ports.length);

export function run(
  page: Page,
  port: number,
  request: { id: number; job: string; input?: unknown },
) {
  return page.evaluate(([index, job]) => window.backgroundPorts?.run(index, job), [
    port,
    request,
  ] as const);
}
