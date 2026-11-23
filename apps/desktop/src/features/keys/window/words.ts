// The keymap file's problems and the failures of opening it, in words: main sends each as a kind,
// with what the system said, and the window writes the sentence.

import { IpcError } from '../../../ipc/contract.ts';
import { NO_TEXT_APP, TEXT_APP_QUERY, UNSUPPORTED } from '../../../window/explain.ts';
import type { KeymapFile as Shown, KeymapProblem } from '../../../window/commands/keymap.ts';
import type { KeymapFile } from '../contract.ts';

/** `bytes` in megabytes, rounded up to a tenth, so a file just over the limit reads as over it. */
function megabytes(bytes: number): string {
  return `${(Math.ceil((bytes / 1024 ** 2) * 10) / 10).toLocaleString()} MB`;
}

/** The refusal on a dimmed "Open keymap file" for a file Lo can't read. */
const CANT_OPEN = 'The keymap file can’t be opened';

/** The keymap file main read, with what's wrong with it in words, and why it can't be opened. */
export function keymapWords(file: KeymapFile): Shown {
  const { text, canOpen } = file;
  const { problem } = file;
  if (problem === undefined) return { text, canOpen };
  const reading = (reason: string | undefined, details?: string): Shown => ({
    text,
    canOpen,
    problem: { title: 'Can’t read the keymap file', reason, details } satisfies KeymapProblem,
    refusal: CANT_OPEN,
  });
  switch (problem.kind) {
    case 'notFile':
      return reading('It isn’t a file.');
    case 'tooLarge':
      return reading(`It’s ${megabytes(problem.size)}, over the 1 MB limit.`);
    case 'notText':
      return reading('It isn’t text.');
    case 'brokenLink':
      return reading('It links to a file that doesn’t exist.');
    case 'denied':
      return reading('Its permissions don’t allow reading it.');
    case 'unreadable':
      return reading(undefined, problem.code);
    case 'executable':
      // Its keys apply: only opening it is refused, since that could run it.
      return {
        text,
        canOpen,
        refusal: 'The keymap file is executable',
        remedy: 'Clear its execute permission to open it from here.',
      };
    default:
      throw new Error(
        `A keymap problem Lo doesn't know: ${JSON.stringify(problem satisfies never)}`,
      );
  }
}

/** Opening the keymap file failed: why, as a toast's title, reason and Details. */
export function unopenedWords(
  error: unknown,
  refusal: string | undefined,
): { title: string; reason: string; details: string | undefined } {
  const title = 'Couldn’t open the keymap file';
  const said = error instanceof IpcError && error.message !== '' ? error.message : undefined;
  if (!(error instanceof IpcError)) return { title, reason: '', details: String(error) };
  switch (error.code) {
    case 'create':
      return { title: 'Couldn’t create the keymap file', reason: '', details: said };
    case 'refused':
      return { title, reason: refusal === undefined ? '' : `${refusal}.`, details: said };
    case 'noApp':
      return { title, reason: NO_TEXT_APP, details: TEXT_APP_QUERY };
    case 'unsupported':
      return { title, reason: UNSUPPORTED, details: said };
    default:
      return { title, reason: '', details: said };
  }
}
