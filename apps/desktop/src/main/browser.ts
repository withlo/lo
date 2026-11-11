// Opening web pages in the system's browser, for every feature that hands one there.

import { spawn } from 'node:child_process';

import { app, shell } from 'electron';

import { browserProgram } from './environment.ts';

/**
 * Opens `page` in the system's browser, or with the program `LO_BROWSER` names in a build run from
 * source, which gets an environment of its own and the address as its one argument. Callers check
 * the address first: this opens whatever it's given.
 */
export async function openPage(page: string): Promise<void> {
  const program = browserProgram({ packaged: app.isPackaged, env: process.env });
  if (program === undefined) {
    await shell.openExternal(page, { activate: true });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, [page], {
      shell: false,
      stdio: 'ignore',
      env: { PATH: '/usr/bin:/bin' },
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${program} exited with ${String(code)}`));
    });
  });
}
