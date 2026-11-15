/**
 * Starting a server's process, and stopping it with everything it started.
 *
 * - No shell: the server's own program, by absolute path, with an argument list. The program is a
 *   compiled program, never a script (a launcher such as `bin/jdtls` is Python, and Kotlin's is a
 *   shell script), and it isn't inside the checkout.
 * - A process group of its own (`detached`), so a signal to the group reaches whatever the server
 *   started, and a terminal's Ctrl-C, which goes to the terminal's group, never reaches it.
 * - The environment it's given and nothing else: never Lo's, and never an empty one, which some
 *   launchers take to mean "inherit everything".
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, open, realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { isInside } from './environment.ts';

/** How often a group is checked for processes while Lo waits for it to empty. */
const GROUP_POLL = 25;

/**
 * Checks that `program` is one a server may run as: an absolute path outside the checkout (each of
 * `roots` names it), to an executable file that isn't a script. It throws with what's wrong.
 */
export async function checkProgram(program: string, roots: readonly string[]): Promise<void> {
  if (!isAbsolute(program)) throw new Error(`${program} isn’t an absolute path.`);
  const real = await realpath(program);
  if (roots.some((root) => isInside(root, program) || isInside(root, real))) {
    throw new Error(`${program} is inside the checkout.`);
  }
  const info = await stat(real);
  if (!info.isFile()) throw new Error(`${program} isn’t a file.`);
  await access(program, constants.X_OK);
  const file = await open(program, 'r');
  try {
    const start = Buffer.alloc(2);
    const { bytesRead } = await file.read(start, 0, 2, 0);
    if (bytesRead === 2 && start.toString('latin1') === '#!') {
      throw new Error(`${program} is a script, and a server runs only as its own program.`);
    }
  } finally {
    await file.close();
  }
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
 * Sends `signal` to every process in the group `group`, and says whether there was one to send it
 * to. It never throws.
 */
export function signalGroup(group: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-group, signal);
    return true;
  } catch {
    return false;
  }
}

/** Whether any process is left in the group `group`. */
export function groupAlive(group: number): boolean {
  return signalGroup(group, 0);
}

/** Waits at most `within` ms for the group `group` to have no process left, and says whether it does. */
export async function groupEmptied(group: number, within: number): Promise<boolean> {
  const until = performance.now() + within;
  while (groupAlive(group)) {
    if (performance.now() >= until) return false;
    await sleep(Math.min(GROUP_POLL, Math.max(1, until - performance.now())));
  }
  return true;
}

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
