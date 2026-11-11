import { commandsOf, defineCommands } from '@lo/ui/commands';
import { expect, it } from 'vitest';

import { checkCommands, checkViews } from './features.ts';
import { defineSlot, defineView } from './slots.tsx';

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

const middle = defineSlot('tab.middle');
const diff = defineView(middle, { id: 'diff.diff', order: 10, render: () => null });
const file = defineView(middle, { id: 'diff.file', order: 20, render: () => null });

it("collects features' views, each named under its own folder's name, once", () => {
  expect(
    checkViews({
      '../features/diff/window/index.ts': { views: [diff, file] },
      '../features/app/window/index.ts': {},
    }),
  ).toEqual([diff, file]);
  expect(() => checkViews({ '../features/tree/window/index.ts': { views: [diff] } })).toThrow(
    '../features/tree/window/index.ts has the view diff.diff, but its folder is "tree".',
  );
  expect(() => checkViews({ '../features/diff/window/index.ts': { views: [diff, diff] } })).toThrow(
    '../features/diff/window/index.ts has two views named diff.diff.',
  );
});
