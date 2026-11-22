import { IpcError } from '../../ipc/contract.ts';
import { defineService } from '../../main/services.ts';
import type { Setting } from './contract.ts';

/**
 * Why a change to a setting wasn't written, as `unwritable`: the message names the setting, as
 * Settings says it; `why` says what's wrong alone, in a sentence, without what to do, for a caller
 * to say that in its own words; and `inFile` is whether what the file holds is the cause, which
 * editing the file fixes, rather than the disk or someone else saving it. Settings says it as
 * `said` has it, when it does: a `reason` in a sentence, where what's between backticks is code,
 * and `details`, the words of what failed.
 */
export class Unwritten extends IpcError {
  readonly why: string;
  readonly inFile: boolean;
  readonly said: { readonly reason?: string; readonly details?: string };

  constructor(
    message: string,
    why: string,
    inFile: boolean,
    said: { readonly reason?: string; readonly details?: string } = {},
  ) {
    super('unwritable', message);
    this.name = 'Unwritten';
    this.why = why;
    this.inFile = inFile;
    this.said = said;
  }
}

/** The settings file, for features that apply a setting in main, or keep one the window shows. */
export interface SettingsStore {
  /**
   * Makes a setting known: from then on the file's value for it is checked (a value its schema
   * refuses is reported and ignored), and the window may change it. A feature declares each of
   * its settings once, in `start`.
   */
  declare<T>(setting: Setting<T>): void;
  /**
   * Declares `setting` if it isn't, and calls `listener` with its value once Lo has read the file
   * and again each time it changes, whether the file was edited or Settings changed it. It runs
   * no sooner than the file has been read, so a setting is never applied at its default first.
   * Returns a function that stops it.
   */
  watch<T>(setting: Setting<T>, listener: (value: T) => void): () => void;
  /**
   * Changes `setting` from main, as only main may change one the window can only read: declares it
   * if it isn't, reads the file afresh, and writes `change` of its value there (its default when
   * the file has none). `change` may be called again on the file as a person saved it meanwhile,
   * so it makes its answer from what it's given alone. Other settings, and what Lo doesn't know
   * of, stay in the file as they are. Fails with an `IpcError` as Settings' changes do: `invalid`
   * when `change` makes a value the schema refuses, and `unwritable`, as an {@link Unwritten} that
   * says why, when the file has a problem, holds a value the schema refuses, which Lo never
   * replaces with one made from nothing, or can't be written.
   */
  update<T>(setting: Setting<T>, change: (value: T) => T): Promise<void>;
}

export const settings = defineService<SettingsStore>('settings.file');

/**
 * What Settings' "Clear the cache" clears besides the local copies and the answers saved from
 * GitHub: what other features keep to open pull requests fast, each added by its own feature.
 */
export interface CacheClearing {
  /**
   * Calls `clear` each time the cache is cleared, before the local copies are. One that throws
   * fails the clearing. Returns a function that stops it.
   */
  onClear(clear: () => void): () => void;
}

export const clearing = defineService<CacheClearing>('settings.clearing');
