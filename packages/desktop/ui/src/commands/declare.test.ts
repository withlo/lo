import { describe, expect, test } from 'vitest';

import { commandsOf, defineCommands, handlers, isCommandId } from './declare.ts';
import type { FileTarget, LineTarget, NoTarget, ThreadTarget } from './targets.ts';

const keys = defineCommands('diff', {
  markViewed: {
    label: 'Mark viewed',
    group: 'Act',
    keys: ['e'],
    targets: ['line', 'file'],
    when: { scope: ['diff', 'tree'], mode: 'normal' },
  },
  reply: { label: 'Reply', group: 'Threads', keys: ['r'], targets: ['thread'] },
  help: { label: 'Every key', group: 'Tabs and window', keys: ['?'] },
  down: { label: 'Line down', group: 'Move', keys: ['j'], vim: 'own' },
});

describe('declarations', () => {
  test('give each command its id, from the feature and its name', () => {
    expect(commandsOf(keys).map((command) => [command.id, command.feature, command.name])).toEqual([
      ['diff.markViewed', 'diff', 'markViewed'],
      ['diff.reply', 'diff', 'reply'],
      ['diff.help', 'diff', 'help'],
      ['diff.down', 'diff', 'down'],
    ]);
    expect(isCommandId('diff.markViewed')).toBe(true);
    expect(isCommandId('diff')).toBe(false);
    expect(isCommandId('diff.mark.viewed')).toBe(false);
    expect(isCommandId('Diff.markViewed')).toBe(false);
  });

  test('fail as they load on a key Lo can’t read, or a name that isn’t one', () => {
    expect(() =>
      defineCommands('diff', { bad: { label: 'Bad', group: 'Act', keys: ['cmd+'] } }),
    ).toThrow('Keys "cmd+": "cmd+" has no key after its last "+".');
    expect(() =>
      defineCommands('diff', {
        bad: { label: 'Bad', group: 'Act', keys: [{ keys: 'hyper+x', on: 'mac' }] },
      }),
    ).toThrow("isn't a modifier");
    expect(() => defineCommands('my-feature', {})).toThrow('"my-feature" isn\'t a feature name');
    expect(() =>
      defineCommands('diff', { 'mark-viewed': { label: 'x', group: 'Act', keys: [] } }),
    ).toThrow('"diff.mark-viewed" isn\'t a command id.');
  });

  test('keep the scopes a feature names', () => {
    expect(defineCommands('tree', {}, { scopes: ['tree'] }).scopes).toEqual(['tree']);
    expect(keys.scopes).toEqual([]);
  });

  test('load in Node, with no DOM, for the checks and the docs', async () => {
    expect(typeof document).toBe('undefined');
    const engine = await import('./index.ts');
    expect(engine.defineCommands).toBe(defineCommands);
  });
});

describe('handlers', () => {
  test('are typed from the declarations, one for each command but Vim’s own', () => {
    const given = handlers(keys, {
      markViewed: {
        run(target) {
          target satisfies LineTarget | FileTarget;
        },
        enabled: (target) => target.kind === 'line' || 'Not on a file.',
      },
      reply: {
        run(target) {
          target satisfies ThreadTarget;
        },
      },
      help: {
        run(target) {
          target satisfies NoTarget;
        },
      },
    });
    expect(given.map((command) => [command.id, command.handler !== undefined])).toEqual([
      ['diff.markViewed', true],
      ['diff.reply', true],
      ['diff.help', true],
      ['diff.down', false],
    ]);

    // @ts-expect-error: every command but Vim's own needs a handler.
    handlers(keys, { markViewed: { run() {} }, reply: { run() {} } });
    handlers(keys, {
      markViewed: { run() {} },
      reply: { run() {} },
      help: { run() {} },
      // @ts-expect-error: Vim's own keys have no handler.
      down: { run() {} },
    });
    handlers(keys, {
      markViewed: { run() {} },
      // @ts-expect-error: a reply acts on a thread, never a file.
      reply: { run(_target: FileTarget) {} },
      help: { run() {} },
    });
  });
});
