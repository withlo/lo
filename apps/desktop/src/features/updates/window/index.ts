// The updates feature's window side: its commands, from the command palette and the app menu, each
// of which asks main to act. A check says what it found in a note, and so do a download that's
// ready and one that failed; main refuses a command that doesn't apply now, and the note says why.

import { handlers } from '@lo/ui/commands';

import { IpcError } from '../../../ipc/contract.ts';
import { announce, notify } from '../../../window/commands/notices.tsx';
import type { WindowFeature } from '../../../window/features.ts';
import { client, type Client } from '../../../window/ipc.ts';
import { contract, type CheckAnswer, type UpdateState } from '../contract.ts';
import keys from '../keys.ts';

let connected: Client<typeof contract> | undefined;

/** The feature's client, made when it's first needed, once the window's bridge is there. */
function main(): Client<typeof contract> {
  connected ??= client(contract);
  return connected;
}

/** What went wrong asking main, in words to show. */
function whyNot(error: unknown): string {
  return error instanceof IpcError ? error.message : 'Lo couldn’t ask for it. Try again.';
}

/** Runs `request`, and says why it didn't happen in a note titled `title`. */
async function asking(title: string, request: () => Promise<void>): Promise<void> {
  try {
    await request();
  } catch (error) {
    notify(title, whyNot(error));
  }
}

/** Says what a check asked for found. */
function tell(answer: CheckAnswer): void {
  switch (answer.status) {
    case 'newest':
      announce(`Lo ${answer.version} is the newest version.`);
      return;
    case 'failed':
      notify('Lo couldn’t check for updates', answer.reason);
      return;
    case 'available':
      announce(`Lo ${answer.version} is out`, answer.line);
      return;
    case 'downloading':
      announce(`Lo ${answer.version} is downloading`);
      return;
    case 'ready':
      announce(`Lo ${answer.version} is ready`, 'It installs when you quit, or now.');
      return;
    default:
      throw new Error(
        `A check's answer Lo doesn't know: ${JSON.stringify(answer satisfies never)}`,
      );
  }
}

/** What main last said, to tell a download's end from where things stood before. */
let last: UpdateState | undefined;

/** Says when a download is ready, or failed. */
function heard(state: UpdateState): void {
  const before = last;
  last = state;
  if (before?.status !== 'downloading') return;
  if (state.status === 'ready') {
    announce(`Lo ${state.version} is ready`, 'It installs when you quit, or now.');
  } else if (state.status === 'available' && state.failed !== undefined) {
    notify('Lo couldn’t download the update', state.failed);
  }
}

export default {
  commands: handlers(keys, {
    check: {
      run: async () => {
        try {
          tell(await main().check());
        } catch (error) {
          notify('Lo couldn’t check for updates', whyNot(error));
        }
      },
    },
    install: { run: () => asking('Lo couldn’t install the update', () => main().install()) },
    restart: { run: () => asking('Lo couldn’t restart to update', () => main().restart()) },
    move: { run: () => asking('Lo couldn’t move to Applications', () => main().move()) },
    later: { run: () => asking('Lo couldn’t hide the update', () => main().later()) },
  }),
  start() {
    const updates = main();
    // Subscribed first, so no change between the two is missed.
    updates.subscribe('state', heard);
    updates
      .read()
      .then((state) => {
        last ??= state;
      })
      .catch((error: unknown) => console.error("Lo couldn't read where updates stand:", error));
  },
} satisfies WindowFeature;
