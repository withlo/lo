import { commandsOf, defineCommands } from '@lo/ui/commands';
import { expect, it } from 'vitest';

import { checkCommands } from './features.ts';

const keys = commandsOf(
  defineCommands('keys', { help: { label: 'Every key', group: 'Tabs and window', keys: ['?'] } }),
);

it("collects features' commands, each declared under its own folder's name", () => {
  expect(checkCommands({ '../features/keys/window/index.ts': { commands: keys } })).toEqual(keys);
  expect(checkCommands({ '../features/app/window/index.ts': {} })).toEqual([]);
  expect(() => checkCommands({ '../features/tree/window/index.ts': { commands: keys } })).toThrow(
    '../features/tree/window/index.ts has the command keys.help, but its folder is "tree".',
  );
});
