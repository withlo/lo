import {
  app,
  MessageChannelMain,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from 'electron';

// electron-vite builds the process's script and gives its path as this import's default.
// oxlint-disable-next-line import/default
import backgroundEntry from '../background/index.ts?modulePath';
import { handOver } from '../ipc/jobs.ts';
import type { BackgroundSettings } from './environment.ts';
import { nextAttempt, pastCap, restartDelay } from './restarts.ts';

export interface Background {
  /** Connects a window to the process each time its page loads, and again after each restart. */
  attach(contents: WebContents): void;
  stop(): void;
}

/**
 * Starts the background process and keeps it running. Main reads its memory every second and
 * kills it past the cap, since memory outside the JavaScript heap (WebAssembly's) can't be capped
 * any other way. After any exit it starts again, waiting longer after each quick failure, and
 * every window gets a new port; the window fails the jobs it had sent as `restarted`.
 */
export function startBackground(settings: BackgroundSettings): Background {
  const windows = new Set<WebContents>();
  let child: UtilityProcess | undefined;
  let startedAt = 0;
  let attempt = 0;
  let restart: NodeJS.Timeout | undefined;
  let stopped = false;

  const connect = (contents: WebContents) => {
    if (!child || contents.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage('connect', [port1]);
    contents.postMessage(handOver, null, [port2]);
  };

  const start = () => {
    startedAt = Date.now();
    // Only what it needs from the environment, so no token in it reaches the process.
    const process = utilityProcess.fork(backgroundEntry, [], {
      serviceName: 'Lo background',
      env: settings.testJobs ? { LO_TEST_JOBS: '1' } : {},
      stdio: 'inherit',
    });
    child = process;
    process.once('exit', (code) => {
      child = undefined;
      if (stopped) return;
      attempt = nextAttempt(attempt, Date.now() - startedAt);
      const delay = restartDelay(attempt);
      console.error(`The background process stopped (${code}); starting it again in ${delay} ms.`);
      restart = setTimeout(start, delay);
    });
    // A page still loading gets its port when it finishes, as every page does.
    for (const contents of windows) if (!contents.isLoading()) connect(contents);
  };

  const watch = setInterval(() => {
    const pid = child?.pid;
    if (pid === undefined) return;
    const metric = app.getAppMetrics().find((process) => process.pid === pid);
    if (metric && pastCap(metric.memory.workingSetSize, settings.memoryCap)) {
      const used = Math.round(metric.memory.workingSetSize / 1024);
      const cap = Math.round(settings.memoryCap / 1024 ** 2);
      console.error(`The background process used ${used} MB, past its ${cap} MB; stopping it.`);
      child?.kill();
    }
  }, 1000);

  start();

  return {
    attach(contents) {
      windows.add(contents);
      contents.on('did-finish-load', () => connect(contents));
      contents.once('destroyed', () => windows.delete(contents));
    },
    stop() {
      stopped = true;
      clearInterval(watch);
      clearTimeout(restart);
      child?.kill();
    },
  };
}
