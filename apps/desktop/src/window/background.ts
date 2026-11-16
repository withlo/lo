// The window's side of the background process: the port main hands it, and a client per job group
// whose methods and types come from the group's contract. Main hands it the code port the same way,
// with each load of the page, for what code features ask of main.

import {
  createConnection,
  isCodeHandOver,
  isHandOver,
  jobs as clientOn,
  type Connection,
  type JobContract,
  type Jobs,
} from '../ipc/jobs.ts';

export {
  createConnection,
  type Connection,
  type Jobs,
  type Port,
  type RunOptions,
} from '../ipc/jobs.ts';

/** The window's connection, which takes each port main hands over through the preload. */
export const background = createConnection();

/**
 * The window's connection to main's code port: what code features ask of main, such as a name's
 * definitions, answered from the syntax index. A new port comes with each load of the page.
 */
export const code = createConnection('The code port');

declare global {
  interface Window {
    /** The window's connection, for the smoke test, in a build run from source with test jobs. */
    loBackground?: Connection;
  }
}

/** Listens for main's news of the process. Runs once, as the window starts, so none is missed. */
export function listenForBackground(): void {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const [port] = event.ports;
    if (isCodeHandOver(event.data)) {
      if (port) code.connect(port);
      return;
    }
    if (!isHandOver(event.data)) return;
    if (event.data.state === 'lost') background.lose();
    else if (port) background.connect(port);
    if (event.data.testing) window.loBackground = background;
  });
}

/** A job group's client: `jobs(contract).highlight(input)` runs `<group>.highlight`. */
export function jobs<C extends JobContract>(
  contract: C,
  connection: Connection = background,
): Jobs<C> {
  return clientOn(contract, connection);
}
