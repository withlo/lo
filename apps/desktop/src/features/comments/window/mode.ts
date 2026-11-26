// How review threads show in code, in the window: the `comments.threads` setting, beside lines, as
// a mark in the gutter that opens over the code, or between them, in the flow. Every pull request's
// diff follows it as it changes, and the keys that only work beside lines are off between them.

import type { ThreadsMode } from '@lo/ui/code';

import { registry } from '../../../window/commands/registry.ts';
import { client } from '../../../window/ipc.ts';
import { threadsShowChanged } from '../../diff/window/shared.ts';
import { contract as settings, type SettingsState } from '../../settings/contract.ts';
import { threads } from '../settings.ts';

/** The keys of a thread's popover, which only opens beside lines. */
const BESIDE = [
  'comments.openThread',
  'comments.closeThread',
  'comments.nextComment',
  'comments.previousComment',
];

let mode: ThreadsMode = threads.fallback;

/** Whether main has said what the settings are since the window asked. */
let told = false;

/** Shows threads as `next` says: the diffs draw them so, and the popover's keys are on beside. */
function show(next: ThreadsMode): void {
  registry().setOff(BESIDE, next !== 'beside');
  if (next === mode) return;
  mode = next;
  threadsShowChanged();
}

function take(state: SettingsState): void {
  told = true;
  const value = threads.schema.safeParse(state.values[threads.key]);
  show(value.success ? value.data : threads.fallback);
}

/** How review threads show in code now. */
export function threadsMode(): ThreadsMode {
  return mode;
}

/** Follows the setting: as the file has it now, and each time it changes. */
export function followThreadsMode(): void {
  registry().setOff(BESIDE, mode !== 'beside');
  client(settings).subscribe('state', take);
  client(settings)
    .read()
    .then((state) => {
      // A change main sent while the answer was on its way is newer than the answer.
      if (!told) take(state);
    })
    .catch((error: unknown) => {
      console.error("Lo couldn't read how threads show in code:", error);
    });
}
