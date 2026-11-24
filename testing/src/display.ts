// On Linux, an X display for each Playwright worker, so the windows two workers open at once never
// share one: the desktop app's smoke test, the ui specs and the performance suite each give every
// worker its own (`onOwnDisplay`). With no window manager, X gives focus to the window under the
// pointer, and to a window that asks for it as it opens. On a shared display, a window one worker
// opened took focus from the other worker's window, and gave it back as it closed: Lo, in the
// background or in front by turns, read GitHub on a schedule its cassettes didn't record. On a
// display of its own, the pointer rests where Xvfb starts it, in the middle, which is in Lo's
// window, as Lo centers it: the window has focus from when it opens, and it gets focus back when a
// window it opened itself closes.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';

/** A virtual X display of its own. */
export interface Display {
  /** Its name, as `DISPLAY` takes it, such as `:1`. */
  readonly name: string;
  /** Stops its server, once nothing runs on it. */
  stop(): Promise<void>;
}

/**
 * Starts Xvfb on the first free display number, which it writes to the pipe on its fd 3 once it
 * takes connections (`-displayfd`), so two workers starting at once never take the same one. It
 * doesn't reset when its last client leaves (`-noreset`), as it would between tests, when a copy
 * of Lo starting just then would find no display.
 */
export async function startDisplay(): Promise<Display> {
  const server = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1920x1080x24', '-noreset'], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
  });
  // The last of what it says, for when it stops before it takes connections.
  let said = '';
  server.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    said = (said + chunk).slice(-2_000);
  });
  const number = await new Promise<string>((resolve, reject) => {
    server.once('error', (error) => {
      reject(
        new Error(
          `Xvfb couldn't start. On Linux, the desktop app's smoke test, ui's specs and the performance suite need it.`,
          { cause: error },
        ),
      );
    });
    server.once('exit', (code, signal) => {
      reject(
        new Error(
          `Xvfb stopped before it took connections (${signal ?? `exit ${code}`}): ${said.trim()}`,
        ),
      );
    });
    const pipe = server.stdio[3];
    if (!(pipe instanceof Readable)) throw new Error('Xvfb was started with no pipe on its fd 3.');
    let written = '';
    pipe.setEncoding('utf8').on('data', (chunk: string) => {
      written += chunk;
      const line = /^(\d+)\n/.exec(written);
      if (!line) return;
      pipe.destroy();
      resolve(line[1]!);
    });
  });
  // A worker can exit before its fixtures come down: Playwright exits one 30 s after its runner
  // goes, done or not. Its display goes with it then.
  const stopOnExit = () => server.kill();
  process.once('exit', stopOnExit);
  return {
    name: `:${number}`,
    async stop() {
      process.off('exit', stopOnExit);
      if (server.exitCode !== null || server.signalCode !== null) return;
      const gone = once(server, 'exit');
      server.kill();
      await gone;
    },
  };
}

/**
 * Runs `use` with a Playwright worker on a display of its own, for a worker-scoped fixture: on
 * Linux, a display `startDisplay` starts, as the worker's `DISPLAY`, which every Electron it starts
 * takes from its environment, with `WAYLAND_DISPLAY` dropped, since Electron takes a Wayland session
 * over X when there's one: the screen of whoever runs the tests. `use` is given the display's name,
 * and the display stops once it's done. Elsewhere, where windows are the system's, `use` is given
 * `undefined`.
 */
export async function onOwnDisplay(
  worker: number,
  use: (display: string | undefined) => Promise<void>,
): Promise<void> {
  if (process.platform !== 'linux') {
    await use(undefined);
    return;
  }
  const display = await startDisplay();
  process.env.DISPLAY = display.name;
  delete process.env.WAYLAND_DISPLAY;
  console.log(`Worker ${worker} runs on display ${display.name}.`);
  try {
    await use(display.name);
  } finally {
    await display.stop();
  }
}
