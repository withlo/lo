import { isCommandId } from '@lo/ui/commands';
import { expect, it } from 'vitest';

import { commandId, contract, KEYMAP_SIZE_LIMIT, keymapFile } from './contract.ts';

it('reads command ids as the registry does, in the menu’s items and the clicks it sends back', () => {
  for (const id of [
    'keys.back',
    'diff.markViewed',
    'a.b1',
    'keys',
    'keys.',
    'Keys.back',
    'a.b.c',
    'a-b.c',
    'diff.mark viewed',
    '',
  ]) {
    expect(commandId.safeParse(id).success).toBe(isCommandId(id));
    expect(contract.topics.run.safeParse({ id }).success).toBe(isCommandId(id));
  }
});

it('opens the keymap file without being told which file: it takes no input', () => {
  const { input } = contract.requests.openKeymap;
  expect(input.safeParse(undefined).success).toBe(true);
  for (const given of ['/etc/passwd', '', { path: '/etc/passwd' }, {}, null, 0]) {
    expect(input.safeParse(given).success).toBe(false);
  }
  expect(contract.requests.readKeymap.input.safeParse('/etc/passwd').success).toBe(false);
});

it('sends the keymap file as text within the limit, and a problem with it', () => {
  expect(keymapFile.safeParse({ text: 'bind x diff.markViewed', canOpen: true }).success).toBe(
    true,
  );
  expect(keymapFile.safeParse({ text: '', problem: 'Too big.', canOpen: false }).success).toBe(
    true,
  );
  expect(keymapFile.safeParse({ text: 'x'.repeat(KEYMAP_SIZE_LIMIT), canOpen: true }).success).toBe(
    true,
  );
  for (const given of [
    { text: 'x'.repeat(KEYMAP_SIZE_LIMIT + 1), canOpen: true },
    { text: '', problem: 'x'.repeat(301), canOpen: false },
    { text: '', path: '/etc/passwd', canOpen: true },
    { problem: 'No text.', canOpen: false },
    // Whether it can be opened is always said.
    { text: '' },
  ]) {
    expect(keymapFile.safeParse(given).success).toBe(false);
    expect(contract.topics.keymap.safeParse(given).success).toBe(false);
  }
});
