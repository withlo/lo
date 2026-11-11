import { isCommandId } from '@lo/ui/commands';
import { expect, it } from 'vitest';

import { commandId, contract } from './contract.ts';

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
