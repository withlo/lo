import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

/** The macOS app menu's menus a command can sit in, as commands declare them in `bar`. */
export const barMenus = ['File', 'View', 'Go', 'Review', 'Window'] as const;

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

/** One of Lo's commands in the app menu, as the window describes it. */
export const barItem = z.strictObject({
  /** The command's id, which a click sends back. */
  id: commandId,
  label: z.string().min(1).max(100),
  menu: z.enum(barMenus),
  order: z.number().finite(),
  /** The command's key, when it's a single chord a menu can show. */
  key: barKey.optional(),
  /** Whether it can run on what has focus now. */
  enabled: z.boolean(),
});

export type BarKey = z.output<typeof barKey>;
export type BarItem = z.output<typeof barItem>;

export const contract = defineContract('keys', {
  requests: {
    /** Lo's commands in the app menu, each time their labels, keys or states change. */
    menu: { input: z.strictObject({ items: z.array(barItem).max(1000) }), reply: reply<void>() },
  },
  topics: {
    /** A click on one of Lo's commands in the app menu, to run through the registry. */
    run: z.strictObject({ id: commandId }),
  },
});
