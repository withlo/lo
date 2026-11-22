// Whether Vim keys are on, in the window: the `editor.vim` setting, which every code view and
// comment box follows as it changes (`setVim` in `@lo/ui/code`), open ones included.

import { setVim, vimOn } from '@lo/ui/code';

import { client } from '../../../window/ipc.ts';
import { contract as settings, type SettingsState } from '../../settings/contract.ts';
import { changeSetting } from '../../settings/window/shared.ts';
import { vim } from '../settings.ts';

/** Whether main has said what the settings are since the window asked. */
let told = false;

function take(state: SettingsState): void {
  told = true;
  const value = vim.schema.safeParse(state.values[vim.key]);
  setVim(value.success ? value.data : vim.fallback);
}

/** Follows the setting: as the file has it now, and each time it changes. */
export function followVim(): void {
  client(settings).subscribe('state', take);
  client(settings)
    .read()
    .then((state) => {
      // A change main sent while the answer was on its way is newer than the answer.
      if (!told) take(state);
    })
    .catch((error: unknown) => {
      console.error("Lo couldn't read whether Vim keys are on:", error);
    });
}

/** Turns Vim keys on, or off, and saves it. */
export async function switchVim(): Promise<void> {
  await changeSetting(vim, !vimOn());
}

/** What the palette says after "Vim keys": whether they're on. */
export function vimDetail(): string {
  return vimOn() ? 'On' : 'Off';
}
