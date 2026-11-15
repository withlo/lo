import { expect, test } from 'vitest';

import { reply } from './requests.ts';

const CONTEXT = {
  settings: { typescript: { tsserver: { maxMemory: 3072 } }, plain: 1 },
  folders: [{ uri: 'file:///lo/checkout', name: 'checkout' }],
};

test('a server gets its settings by section, and null where there are none', () => {
  const items = [
    { section: 'typescript.tsserver.maxMemory' },
    { section: 'typescript' },
    { section: 'missing.key' },
    { section: 'plain.deeper' },
    { section: '__proto__' },
    { section: 'constructor' },
    {},
  ];
  expect(reply('workspace/configuration', { items }, CONTEXT)).toEqual({
    accepted: true,
    result: [3072, CONTEXT.settings.typescript, null, null, null, null, CONTEXT.settings],
  });
  expect(reply('workspace/configuration', { items: 'all' }, CONTEXT).accepted).toBe(false);
  expect(reply('workspace/workspaceFolders', null, CONTEXT)).toEqual({
    accepted: true,
    result: CONTEXT.folders,
  });
});

test('registrations and progress tokens are accepted, and everything else refused', () => {
  for (const method of [
    'client/registerCapability',
    'client/unregisterCapability',
    'window/workDoneProgress/create',
  ]) {
    expect(reply(method, {}, CONTEXT)).toEqual({ accepted: true, result: null });
  }
  for (const method of [
    'workspace/applyEdit',
    'window/showDocument',
    'window/showMessageRequest',
    'workspace/executeCommand',
    'anything/else',
  ]) {
    expect(reply(method, {}, CONTEXT).accepted).toBe(false);
  }
});
