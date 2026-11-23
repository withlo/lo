import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

/** A keystroke a menu item shows, with the modifier keys by their DOM names. */
export const barKey = z.strictObject({
  key: z.string().min(1).max(16),
  meta: z.boolean(),
  ctrl: z.boolean(),
  alt: z.boolean(),
  shift: z.boolean(),
});

/** A command's id, `<feature>.<name>`, as `isCommandId` reads one. */
export const commandId = z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);

/** A name of the app menu's, for a menu or a section of one: `View`, `panels`. */
const barName = z.string().regex(/^[A-Za-z]{1,20}$/);

/**
 * One of Lo's commands in the app menu, as the window describes it: where it is, by the names the
 * app menu's list gives its menus and their sections, which main draws only if it has.
 */
export const barItem = z.strictObject({
  /** The command's id, which a click sends back. */
  id: commandId,
  label: z.string().min(1).max(100),
  menu: barName,
  section: barName,
  order: z.number().finite(),
  /** The command whose place it takes while it can run. */
  instead: commandId.optional(),
  /** The command's key, when it's a single chord a menu can show. */
  key: barKey.optional(),
  /** Whether it can run on what has focus now. */
  enabled: z.boolean(),
  /** A switch, checked while on, or one option of a choice, checked while chosen. */
  toggle: z.enum(['switch', 'choice']).optional(),
  checked: z.boolean().optional(),
});

export type BarKey = z.output<typeof barKey>;
export type BarItem = z.output<typeof barItem>;

/** The most Lo reads of the keymap file, in bytes. A longer file is left unread. */
export const KEYMAP_SIZE_LIMIT = 1024 * 1024;

/**
 * What is wrong with the keymap file as a whole: it isn't a file (a folder, a pipe), it's over the
 * limit at `size` bytes, it isn't text, it links to nothing, its permissions don't let Lo read it,
 * reading it failed with the system's `code`, or it's executable, so Lo won't open it.
 */
export const keymapProblem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('notFile') }),
  z.strictObject({ kind: z.literal('tooLarge'), size: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('notText') }),
  z.strictObject({ kind: z.literal('brokenLink') }),
  z.strictObject({ kind: z.literal('denied') }),
  z.strictObject({ kind: z.literal('unreadable'), code: z.string().max(40).optional() }),
  z.strictObject({ kind: z.literal('executable') }),
]);
export type KeymapProblem = z.output<typeof keymapProblem>;

/**
 * The keymap file as main read it. The window parses `text` and applies it; a file that is missing
 * is no text and no problem, and one Lo can't read is no text and a `problem` to show. An
 * executable file's text is applied, with a `problem` that says why Lo won't open it.
 */
export const keymapFile = z.strictObject({
  text: z.string().max(KEYMAP_SIZE_LIMIT),
  /** What is wrong with the file, if anything is. */
  problem: keymapProblem.optional(),
  /**
   * Whether Lo will open the file in an editor: a plain, non-executable text file within the limit,
   * or none yet, which opening makes.
   */
  canOpen: z.boolean(),
});

export type KeymapFile = z.output<typeof keymapFile>;

export const contract = defineContract('keys', {
  requests: {
    /** Lo's commands in the app menu, each time their labels, keys or states change. */
    menu: { input: z.strictObject({ items: z.array(barItem).max(1000) }), reply: reply<void>() },
    /**
     * Opens the app menu as a menu at a point of the window that asks, in CSS pixels from its top
     * left: on Linux, whose frameless window has no menu bar, from the end of the tab strip.
     */
    popup: {
      input: z.strictObject({
        x: z.number().finite().nonnegative().max(100_000),
        y: z.number().finite().nonnegative().max(100_000),
      }),
      reply: reply<void>(),
    },
    /** The keymap file as it is now. The `keymap` topic then keeps the window up to date. */
    readKeymap: { input: z.undefined(), reply: reply<KeymapFile>() },
    /**
     * Opens the keymap file as text in the system's editor, writing the file with a commented
     * header first if there is none. It takes no path: only the keymap file can be opened this
     * way, and only if it is a plain, non-executable text file (`canOpen`); otherwise it fails
     * with `unopened` and the reason.
     */
    openKeymap: { input: z.undefined(), reply: reply<void>() },
  },
  topics: {
    /** A click on one of Lo's commands in the app menu, to run through the registry. */
    run: z.strictObject({ id: commandId }),
    /** The keymap file, each time it changes. */
    keymap: keymapFile,
  },
});
