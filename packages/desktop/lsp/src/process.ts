/**
 * Starting a server's process, and stopping it with everything it started.
 *
 * - No shell: the server's own program, by absolute path, with an argument list. The program is a
 *   compiled program, never a script (a launcher such as `bin/jdtls` is Python, and Kotlin's is a
 *   shell script), and it isn't inside the checkout.
 * - A process group of its own (`detached`), so a signal to the group reaches whatever the server
 *   started, and a terminal's Ctrl-C, which goes to the terminal's group, never reaches it. What
 *   left the group, by a session of its own, is found by its parent (`family.ts`) and signalled
 *   too.
 * - The environment it's given and nothing else: never Lo's, and never an empty one, which some
 *   launchers take to mean "inherit everything".
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, open, realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { isInside } from './environment.ts';

/** How often a family is checked for processes while Lo waits for it to end. */
const POLL = 25;

/**
 * Checks that `program` is one a server may run as: an absolute path outside the checkout (each of
 * `roots` names it), to an executable file that isn't a script. It returns the program's real path,
 * the one to start, so what runs is what was checked. It throws with what's wrong.
 */
export async function checkProgram(program: string, roots: readonly string[]): Promise<string> {
  if (!isAbsolute(program)) throw new Error(`${program} isn’t an absolute path.`);
  const real = await realpath(program);
  if (roots.some((root) => isInside(root, program) || isInside(root, real))) {
    throw new Error(`${program} is inside the checkout.`);
  }
  const info = await stat(real);
  if (!info.isFile()) throw new Error(`${program} isn’t a file.`);
  await access(real, constants.X_OK);
  const file = await open(real, 'r');
  try {
    const start = Buffer.alloc(2);
    const { bytesRead } = await file.read(start, 0, 2, 0);
    if (bytesRead === 2 && start.toString('latin1') === '#!') {
      throw new Error(`${program} is a script, and a server runs only as its own program.`);
    }
  } finally {
    await file.close();
  }
  return real;
}

/** Starts `program` in a process group of its own, with pipes for its stdio. */
export function startProcess(
  program: string,
  args: readonly string[],
  options: { readonly env: Readonly<Record<string, string>>; readonly cwd: string },
): ChildProcess {
  if (Object.keys(options.env).length === 0) {
    throw new Error('a server needs an environment of its own');
  }
  return spawn(program, args, {
    shell: false,
    env: { ...options.env },
    cwd: options.cwd,
    detached: true,
    stdio: 'pipe',
    windowsHide: true,
  });
}

/**
 * Sends `signal` to every process in the group `group` and to each of `others`, and says whether
 * any was there to send it to. It never throws.
 */
export function signalFamily(
  group: number,
  others: readonly number[],
  signal: NodeJS.Signals | 0,
): boolean {
  let found = false;
  for (const pid of [-group, ...others]) {
    try {
      process.kill(pid, signal);
      found = true;
    } catch {
      // It's gone.
    }
  }
  return found;
}

/**
 * Waits at most `within` ms for the group `group` and each of `others` to have no process left,
 * and says whether they have.
 */
export async function familyGone(
  group: number,
  others: readonly number[],
  within: number,
): Promise<boolean> {
  const until = performance.now() + within;
  while (signalFamily(group, others, 0)) {
    if (performance.now() >= until) return false;
    await sleep(Math.min(POLL, Math.max(1, until - performance.now())));
  }
  return true;
}

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
