import { describe, expect, test } from 'vitest';

import {
  checkClashes,
  checkHandlers,
  checkIds,
  checkKeys,
  checkMenus,
  checkVim,
  vimMeetings,
} from './checks.ts';
import { commandsOf, defineCommands, handlers, type Declaration } from './declare.ts';
import { vimDefaults } from './vim.ts';

/** One feature declaring `commands`, with scopes of its own. */
function feature(
  commands: Record<string, Declaration>,
  name = 'diff',
  scopes: readonly string[] = [],
) {
  return defineCommands(name, commands, { scopes });
}

const passing = [
  feature(
    {
      markViewed: {
        label: 'Mark viewed',
        group: 'Act',
        keys: ['e'],
        overVim: true,
        when: { scope: ['diff', 'tree'], mode: 'normal' },
        menu: { on: 'file', order: 20 },
      },
      nextFile: { label: 'Next file', group: 'Jump', keys: ['] f'], vim: 'motion' },
      down: { label: 'Line down', group: 'Move', keys: ['j'], vim: 'own' },
      submit: { label: 'Submit review', group: 'Review', keys: ['cmd+enter'] },
      add: {
        label: 'Add to review',
        group: 'Comment box',
        keys: ['cmd+enter'],
        when: { scope: 'box' },
      },
      open: {
        label: 'Open a PR',
        group: 'Find',
        keys: ['cmd+l', { keys: 'cmd+o', on: 'mac' }],
        bar: { menu: 'File', order: 10 },
      },
    },
    'diff',
  ),
  feature(
    {
      order: {
        label: 'Tree or review order',
        group: 'Files',
        keys: ['t'],
        when: { scope: 'tree' },
      },
    },
    'tree',
    ['tree'],
  ),
];

describe('the checks', () => {
  test('pass declarations that follow every rule', () => {
    expect(checkIds(passing)).toEqual([]);
    expect(checkKeys(passing)).toEqual([]);
    expect(checkMenus(passing)).toEqual([]);
    expect(checkClashes(passing)).toEqual([]);
    expect(checkVim(passing)).toEqual([]);
  });
});

describe('ids', () => {
  test('are each feature’s and command’s own', () => {
    const one = feature({ a: { label: 'A', group: 'Act', keys: ['x'] } });
    expect(checkIds([one, one])).toEqual([
      'Two features are called diff.',
      'Two commands are called diff.a.',
    ]);
    expect(
      checkIds([
        { feature: 'my-diff', commands: { a: { label: 'A', group: 'Act', keys: [] } }, scopes: [] },
      ]),
    ).toEqual([
      `"my-diff" isn't a feature's name, such as diff.`,
      `"my-diff.a" isn't a command's id, such as diff.markViewed.`,
    ]);
  });

  test('name only scopes the engine, a code view or one feature declares', () => {
    expect(
      checkIds([
        feature({ a: { label: 'A', group: 'Act', keys: ['x'], when: { scope: ['tre', 'diff'] } } }),
        feature({}, 'tree', ['tree', 'box', 'Bad']),
        feature(
          { b: { label: 'B', group: 'Act', keys: ['y'], when: { except: ['tree'] } } },
          'files',
          ['tree'],
        ),
      ]),
    ).toEqual([
      'tree declares the scope box, which the engine already has.',
      `tree declares the scope "Bad", which isn't a scope's name.`,
      'tree and files both declare the scope tree.',
      'diff.a names the scope tre, which no feature declares.',
    ]);
  });
});

describe('handlers', () => {
  const declared = feature({
    reply: { label: 'Reply', group: 'Threads', keys: ['r'] },
    resolve: { label: 'Resolve', group: 'Threads', keys: ['x'] },
    down: { label: 'Line down', group: 'Move', keys: ['j'], vim: 'own' },
  });
  const run = { run() {} };

  test('are one for each command but Vim’s own', () => {
    expect(checkHandlers([declared], handlers(declared, { reply: run, resolve: run }))).toEqual([]);
  });

  test('fail a command without one', () => {
    const given = handlers(declared, { reply: run });
    expect(checkHandlers([declared], given)).toEqual(['diff.resolve has no handler.']);
    expect(checkHandlers([declared], [])).toEqual([
      'diff.reply has no handler.',
      'diff.resolve has no handler.',
    ]);
  });

  test('fail a command with two', () => {
    const given = handlers(declared, { reply: run, resolve: run });
    expect(checkHandlers([declared], [...given, ...given.slice(0, 1)])).toEqual([
      'diff.reply has 2 handlers.',
    ]);
  });

  test('fail a handler without a declaration in keys.ts, or for another declaration', () => {
    const elsewhere = feature({ reply: { label: 'Reply', group: 'Threads', keys: ['R'] } });
    const given = [
      ...handlers(declared, { reply: run, resolve: run }).filter((each) => each.name !== 'reply'),
      ...handlers(elsewhere, { reply: run }),
      ...handlers(feature({ undo: { label: 'Undo', group: 'Act', keys: ['u'] } }, 'edit'), {
        undo: run,
      }),
    ];
    expect(checkHandlers([declared], given)).toEqual([
      "diff.reply in the window's commands isn't as its keys.ts declares it.",
      "edit.undo is in the window's commands, but no keys.ts declares it.",
    ]);
  });

  test('fail one of Vim’s own keys with a handler', () => {
    const [down] = commandsOf(declared).filter((each) => each.name === 'down');
    const given = [
      ...handlers(declared, { reply: run, resolve: run }).slice(0, 2),
      { ...down!, handler: run },
    ];
    expect(checkHandlers([declared], given)).toEqual([
      "diff.down is one of Vim's own keys, which nothing runs, but has a handler.",
    ]);
  });
});

describe('keys', () => {
  test('fail a command without a key on a system it’s on', () => {
    expect(
      checkKeys([
        feature({
          none: { label: 'None', group: 'Act', keys: [] },
          macOnly: { label: 'Mac', group: 'Act', keys: [{ keys: 'cmd+o', on: 'mac' }] },
          linux: {
            label: 'Linux',
            group: 'Act',
            keys: [{ keys: 'cmd+o', on: 'mac' }],
            when: { system: 'linux' },
          },
          mac: {
            label: 'Mac',
            group: 'Act',
            keys: [{ keys: 'cmd+o', on: 'mac' }],
            when: { system: 'mac' },
          },
        }),
      ]),
    ).toEqual([
      'diff.none has no key on macOS.',
      'diff.none has no key on Linux.',
      'diff.macOnly has no key on Linux.',
      'diff.linux has no key on Linux.',
    ]);
  });

  test('pass a command declared with no key that a menu reaches, and no other', () => {
    expect(
      checkKeys([
        feature({
          install: { label: 'Install', group: 'Act', keys: [], bar: { menu: 'App', order: 1 } },
          viewed: { label: 'Viewed', group: 'Act', keys: [], menu: { on: 'file', order: 1 } },
          hidden: { label: 'Hidden', group: 'Act', keys: [] },
        }),
      ]),
    ).toEqual(['diff.hidden has no key on macOS.', 'diff.hidden has no key on Linux.']);
  });
});

describe('menu items', () => {
  test('fail an item without a key, unless its command has none on purpose', () => {
    expect(
      checkMenus([
        feature({
          viewed: { label: 'Viewed', group: 'Act', keys: [], menu: { on: 'file', order: 1 } },
          copy: {
            label: 'Copy',
            group: 'Copy and open',
            keys: [{ keys: 'y y', on: 'linux' }],
            menu: { on: 'line', order: 1 },
          },
          merge: { label: 'Merge', group: 'Review', keys: [], bar: { menu: 'Review', order: 1 } },
          linux: {
            label: 'Linux',
            group: 'Review',
            keys: [],
            when: { system: 'linux' },
            bar: { menu: 'Review', order: 2 },
          },
          ship: {
            label: 'Ship',
            group: 'Review',
            keys: [{ keys: 'g s', on: 'linux' }],
            bar: { menu: 'Review', order: 3 },
          },
        }),
      ]),
    ).toEqual([
      'diff.copy is in the right-click menu of a line, with no key on macOS.',
      "diff.ship is in the app menu's Review menu, with no key on macOS.",
    ]);
  });

  test('fail an item whose menu is for a target its command doesn’t take', () => {
    const problems = checkMenus([
      feature({
        // A line gives its file and its thread, and a command for nothing in particular takes any.
        file: {
          label: 'File',
          group: 'Act',
          keys: ['e'],
          targets: ['file'],
          menu: { on: 'line', order: 1 },
        },
        thread: {
          label: 'Thread',
          group: 'Threads',
          keys: ['r'],
          targets: ['thread', 'layer'],
          menu: { on: 'line', order: 2 },
        },
        window: { label: 'Window', group: 'Find', keys: ['?'], menu: { on: 'block', order: 3 } },
        layer: {
          label: 'Layer',
          group: 'Review',
          keys: ['m'],
          targets: ['layer'],
          menu: { on: 'file', order: 4 },
        },
        line: {
          label: 'Line',
          group: 'Act',
          keys: ['c'],
          targets: ['line', 'thread'],
          menu: { on: 'file', order: 5 },
        },
      }),
    ]);
    expect(problems).toEqual([
      'diff.layer is in the right-click menu of a file, but acts on layer.',
      'diff.line is in the right-click menu of a file, but acts on line or thread.',
    ]);
  });
});

describe('clashes', () => {
  test('fail two commands on the same key in the same scope', () => {
    expect(
      checkClashes([
        feature(
          {
            resolve: { label: 'Resolve', group: 'Threads', keys: ['x'], when: { scope: 'tree' } },
            remove: {
              label: 'Remove',
              group: 'Merge queue',
              keys: ['x'],
              when: { scope: ['tree', 'menu'] },
            },
          },
          'diff',
          ['tree'],
        ),
      ]),
    ).toEqual(['`x` runs both diff.resolve and diff.remove, in tree, on macOS and Linux.']);
  });

  test('fail a key that starts another’s sequence', () => {
    expect(
      checkClashes([
        feature(
          {
            go: { label: 'Go', group: 'Act', keys: ['g'], when: { scope: 'tree' } },
            stack: { label: 'Stack', group: 'Review', keys: ['g S'], when: { scope: 'tree' } },
          },
          'diff',
          ['tree'],
        ),
      ]),
    ).toEqual(['`g` (diff.go) starts `g S` (diff.stack), in tree, on macOS and Linux.']);
  });

  test('fail a prefix between a scope’s command and one for anywhere, which hides one of them', () => {
    expect(
      checkClashes([
        feature(
          {
            go: { label: 'Go', group: 'Act', keys: ['g'], when: { scope: 'tree' } },
            stack: { label: 'Stack', group: 'Review', keys: ['g S'] },
          },
          'diff',
          ['tree'],
        ),
      ]),
    ).toEqual(['`g` (diff.go) starts `g S` (diff.stack), in tree, on macOS and Linux.']);
  });

  test('let a scope’s command take a key that one for anywhere has', () => {
    expect(
      checkClashes([
        feature({
          submit: { label: 'Submit', group: 'Review', keys: ['cmd+enter'] },
          add: { label: 'Add', group: 'Comment box', keys: ['cmd+enter'], when: { scope: 'box' } },
        }),
      ]),
    ).toEqual([]);
  });

  test('try each mode and system, and only where both apply', () => {
    expect(
      checkClashes([
        feature({
          // Only on Linux is cmd+p Ctrl+P.
          files: { label: 'Files', group: 'Find', keys: ['cmd+p'] },
          up: {
            label: 'Up',
            group: 'Act',
            keys: ['ctrl+p'],
            when: { scope: 'diff', mode: 'visual' },
          },
          // Different modes never meet.
          a: { label: 'A', group: 'Act', keys: ['q'], when: { scope: 'diff', mode: 'normal' } },
          b: { label: 'B', group: 'Act', keys: ['q'], when: { scope: 'diff', mode: 'visual' } },
          // Different systems never meet.
          c: { label: 'C', group: 'Act', keys: ['cmd+k'], when: { system: 'mac' } },
          d: { label: 'D', group: 'Act', keys: ['cmd+k'], when: { system: 'linux' } },
        }),
      ]),
    ).toEqual([]);
    expect(
      checkClashes([
        feature({
          files: { label: 'Files', group: 'Find', keys: ['cmd+p'] },
          up: { label: 'Up', group: 'Act', keys: ['ctrl+p'] },
        }),
      ]),
    ).toEqual([
      expect.stringMatching(
        /^`ctrl\+p` runs both diff\.files and diff\.up, in window, .*, on Linux\.$/,
      ),
    ]);
  });

  test('count Lo’s motions in code views, where Vim runs them', () => {
    expect(
      checkClashes([
        feature({
          nextFile: { label: 'Next file', group: 'Jump', keys: ['] f'], vim: 'motion' },
          follow: { label: 'Follow', group: 'Act', keys: [']'], when: { scope: 'diff' } },
        }),
      ]),
    ).toEqual([
      '`]` (diff.follow) starts `] f` (diff.nextFile), in diff (normal) and diff (visual), on macOS and Linux.',
    ]);
  });
});

describe('clashes the engine’s rules hide', () => {
  test('fail a scope’s motion against a command for anywhere on the same key, in code views', () => {
    expect(
      checkClashes([
        feature({
          nextFile: {
            label: 'Next file',
            group: 'Jump',
            keys: ['] f'],
            vim: 'motion',
            when: { scope: 'diff' },
          },
          follow: { label: 'Follow', group: 'Act', keys: ['] f'] },
        }),
      ]),
    ).toEqual([
      '`] f` runs both diff.nextFile and diff.follow, in diff (normal) and diff (visual), on macOS and Linux.',
    ]);
    // Without the motion, the scope's command beats the one for anywhere, as designed.
    expect(
      checkClashes([
        feature({
          nextFile: { label: 'Next file', group: 'Jump', keys: ['] f'], when: { scope: 'diff' } },
          follow: { label: 'Follow', group: 'Act', keys: ['] f'] },
        }),
      ]),
    ).toEqual([]);
  });

  test('fail a menu command on j or k, which move in menus', () => {
    expect(
      checkClashes([
        feature({
          jump: { label: 'Jump', group: 'Act', keys: ['j'], when: { scope: 'menu' } },
          kill: { label: 'Kill', group: 'Act', keys: ['k x'], when: { scope: 'menu' } },
          next: { label: 'Next', group: 'Act', keys: ['n'], when: { scope: 'menu' } },
        }),
      ]),
    ).toEqual([
      '`j` (diff.jump) never runs, since `j` and `k` move as the arrows do, in menu, on macOS and Linux.',
      '`k x` (diff.kill) never runs, since `j` and `k` move as the arrows do, in menu, on macOS and Linux.',
    ]);
  });
});

describe('Vim’s keys', () => {
  test('fail a key over one of Vim’s in a code view without overVim', () => {
    expect(
      checkVim([
        feature({
          markViewed: {
            label: 'Mark viewed',
            group: 'Act',
            keys: ['e'],
            when: { scope: 'diff', mode: 'normal' },
          },
        }),
      ]),
    ).toEqual([
      "`e` (diff.markViewed) meets Vim's `e` without overVim, in diff (normal), on macOS and Linux.",
    ]);
  });

  test('fail a key that starts one of Vim’s, or starts with one Vim reads another key after', () => {
    const problems = checkVim([
      feature({
        go: { label: 'Go', group: 'Act', keys: ['g'], when: { scope: 'peek', mode: 'normal' } },
        link: {
          label: 'Copy a link',
          group: 'Copy and open',
          keys: ['y l'],
          when: { scope: 'peek', mode: 'normal' },
        },
      }),
    ]);
    expect(problems).toContain(
      "`g` (diff.go) meets Vim's `g g` without overVim, in peek (normal), on macOS and Linux.",
    );
    expect(problems).toContain(
      "`y l` (diff.link) meets Vim's `y` without overVim, in peek (normal), on macOS and Linux.",
    );
  });

  test('pass keys Vim doesn’t have, chords in insert mode, and keys outside code views', () => {
    expect(
      checkVim([
        feature(
          {
            next: {
              label: 'Next block',
              group: 'Overview',
              keys: ['] b'],
              when: { scope: 'diff' },
            },
            add: {
              label: 'Add',
              group: 'Comment box',
              keys: ['cmd+enter'],
              when: { scope: 'box' },
            },
            order: { label: 'Order', group: 'Files', keys: ['t'], when: { scope: 'tree' } },
          },
          'diff',
          ['tree'],
        ),
      ]),
    ).toEqual([]);
  });

  test('read cmd as Ctrl on Linux, where it can meet Vim’s Ctrl keys', () => {
    expect(
      checkVim([feature({ files: { label: 'Files', group: 'Find', keys: ['cmd+p'] } })]),
    ).toEqual([
      "`ctrl+p` (diff.files) meets Vim's `ctrl+p` without overVim, in diff (normal), diff (visual), file (normal), file (visual), peek (normal), peek (visual), box (normal) and box (visual), on Linux.",
    ]);
  });

  test('fail overVim on a command whose keys meet none of Vim’s', () => {
    expect(
      checkVim([
        feature({ next: { label: 'Next block', group: 'Overview', keys: ['] b'], overVim: true } }),
      ]),
    ).toEqual(["diff.next says overVim, but none of its keys meets one of Vim's."]);
  });

  test('fail a key declared as Vim’s own that isn’t', () => {
    expect(
      checkVim([feature({ down: { label: 'Down', group: 'Move', keys: ['] b'], vim: 'own' } })]),
    ).toEqual(["diff.down is declared as Vim's own, but `] b` isn't one of Vim's keys."]);
  });

  test('find where each key meets Vim’s, for the docs', () => {
    const [back] = commandsOf(
      feature({
        back: {
          label: 'Back',
          group: 'Code',
          keys: ['ctrl+o'],
          overVim: true,
          when: { except: ['box'] },
        },
      }),
    );
    const meetings = vimMeetings([back!], vimDefaults);
    expect(
      meetings.map(({ site, vim }) => `${site.system} ${site.scope} ${site.mode} ${vim}`),
    ).toEqual([
      'mac diff normal ctrl+o',
      'mac diff visual ctrl+o',
      'mac file normal ctrl+o',
      'mac file visual ctrl+o',
      'mac peek normal ctrl+o',
      'mac peek visual ctrl+o',
      'linux diff normal ctrl+o',
      'linux diff visual ctrl+o',
      'linux file normal ctrl+o',
      'linux file visual ctrl+o',
      'linux peek normal ctrl+o',
      'linux peek visual ctrl+o',
    ]);
  });

  test('are all keys Lo’s notation can read', () => {
    for (const keys of Object.values(vimDefaults)) {
      expect(() =>
        feature({ all: { label: 'All', group: 'Move', keys, vim: 'own' } }),
      ).not.toThrow();
    }
  });
});
