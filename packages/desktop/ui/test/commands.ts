// Commands for the engine's tests, declared as features declare theirs, with the design's keys.

import {
  commandsOf,
  defineCommands,
  type Command,
  type Declarations,
  type KeySource,
  type Mode,
  type Target,
  type VimKey,
} from '../src/commands/index.ts';

export const diff = defineCommands('diff', {
  markViewed: {
    label: 'Mark viewed',
    group: 'Act',
    keys: ['e'],
    targets: ['line', 'file'],
    overVim: true,
    when: { scope: ['diff', 'tree'], mode: 'normal' },
    menu: { on: 'file', order: 20 },
  },
  comment: {
    label: 'Comment',
    group: 'Act',
    keys: ['c'],
    targets: ['line'],
    when: { scope: 'diff' },
  },
  otherSide: {
    label: 'Other side',
    group: 'Act',
    keys: ['tab'],
    targets: ['line'],
    jump: true,
    when: { scope: 'diff' },
  },
  nextFile: { label: 'Next file', group: 'Jump', keys: ['] f'], targets: ['line'], vim: 'motion' },
  copyLine: {
    label: 'Copy the line',
    group: 'Copy and open',
    keys: ['y y'],
    targets: ['line'],
    when: { scope: ['diff', 'file'] },
  },
  copyLink: {
    label: 'Copy a link to it',
    group: 'Copy and open',
    keys: ['y l'],
    targets: ['line'],
    when: { scope: ['diff', 'file'] },
  },
  inline: {
    label: 'Inline or side by side',
    group: 'Diff view',
    keys: ['g i'],
    when: { scope: 'diff' },
  },
  expand: {
    label: 'Expand unchanged code',
    group: 'Diff view',
    keys: ['z o'],
    when: { scope: 'diff' },
  },
  reply: {
    label: 'Reply',
    group: 'Threads',
    keys: ['r'],
    targets: ['thread'],
    when: { scope: 'diff' },
  },
});

export const vim = defineCommands('vim', {
  down: { label: 'Line down', group: 'Move', keys: ['j'], vim: 'own' },
  up: { label: 'Line up', group: 'Move', keys: ['k'], vim: 'own' },
  top: { label: 'Top', group: 'Move', keys: ['g g'], vim: 'own' },
});

export const review = defineCommands('review', {
  submit: { label: 'Submit review', group: 'Review', keys: ['cmd+enter'] },
  add: {
    label: 'Add to review',
    group: 'Comment box',
    keys: ['cmd+enter'],
    when: { scope: 'box' },
  },
  now: { label: 'Comment now', group: 'Comment box', keys: ['alt+enter'], when: { scope: 'box' } },
  preview: {
    label: 'Write or preview',
    group: 'Comment box',
    keys: ['cmd+shift+v'],
    when: { scope: 'box' },
  },
  close: {
    label: 'Close and keep the draft',
    group: 'Comment box',
    keys: ['esc esc'],
    when: { scope: 'box', mode: 'normal' },
  },
});

export const keys = defineCommands('keys', {
  help: { label: 'Every key', group: 'Tabs and window', keys: ['?'] },
  palette: { label: 'Every action', group: 'Find', keys: ['cmd+shift+p'] },
  back: {
    label: 'Back',
    group: 'Code',
    keys: ['ctrl+o'],
    overVim: true,
    when: { except: ['box'] },
  },
  forward: {
    label: 'Forward',
    group: 'Code',
    keys: ['ctrl+i'],
    overVim: true,
    when: { except: ['box'] },
  },
  tree: { label: 'Tree at this file', group: 'Files', keys: ['-'] },
  erase: { label: 'Never on its own', group: 'Find', keys: ['backspace'] },
  nextView: { label: 'Next view', group: 'View', keys: ['`'] },
});

export const tab = defineCommands('tab', {
  close: {
    label: 'Close the tab',
    group: 'Tabs and window',
    keys: ['cmd+w'],
    targets: ['tab', 'none'],
  },
  open: {
    label: 'Open a PR',
    group: 'Find',
    keys: ['cmd+l', { keys: 'cmd+o', on: 'mac' }],
  },
  install: {
    label: 'Install the command-line tool',
    group: 'Tabs and window',
    keys: ['cmd+shift+i'],
    when: { system: 'mac' },
  },
});

export const tree = defineCommands(
  'tree',
  {
    openAll: { label: 'Open all', group: 'Files', keys: ['z R'], when: { scope: 'tree' } },
    closeAll: { label: 'Close all', group: 'Files', keys: ['z M'], when: { scope: 'tree' } },
  },
  { scopes: ['tree'] },
);

export const palette = defineCommands('palette', {
  run: { label: 'Run', group: 'Palettes', keys: ['enter'], when: { scope: 'palette' } },
  next: {
    label: 'Next',
    group: 'Palettes',
    keys: ['down'],
    repeat: true,
    when: { scope: 'palette' },
  },
});

export const overview = defineCommands(
  'overview',
  {
    nextBlock: {
      label: 'Next block',
      group: 'Overview',
      keys: ['] b'],
      targets: ['block', 'none'],
      repeat: true,
      when: { scope: 'overview' },
    },
    previousBlock: {
      label: 'Previous block',
      group: 'Overview',
      keys: ['[ b'],
      targets: ['block', 'none'],
      when: { scope: 'overview' },
    },
  },
  { scopes: ['overview'] },
);

export const all: readonly Declarations[] = [diff, vim, review, keys, tab, tree, palette, overview];

/** A run of a command: its id and the target it got. */
export type Ran = readonly [string, Target];

/**
 * Every test command, each with a handler that records its runs in `ran`. `vim.*` have none, as
 * Vim's own keys have none.
 */
export function testCommands(ran: Ran[] = []): Command[] {
  return all.flatMap((declarations) =>
    commandsOf(declarations).map((command) =>
      command.vim === 'own'
        ? command
        : {
            ...command,
            handler: {
              run(target: Target) {
                ran.push([command.id, target]);
              },
            },
          },
    ),
  );
}

/**
 * A code view as the registry sees it: Vim's state, and a log of what the registry asked of it.
 * Keys replayed into it leave Vim waiting for the rest of the command, as they would.
 */
export class FakeView implements KeySource {
  mode: Mode = 'normal';
  pending = false;
  target: Target = { kind: 'line', at: { file: 'a.ts', side: 'new', line: 1 } };
  vimKeys: readonly VimKey[] = [];
  readonly log: string[];

  constructor(log: string[] = []) {
    this.log = log;
  }

  keyState() {
    return { mode: this.mode, pending: this.pending, target: this.target };
  }

  passKeys(held: readonly string[]) {
    this.log.push(`passKeys ${held.join(' ')}`);
    this.pending = true;
  }

  clearPending() {
    this.log.push('clearPending');
    this.pending = false;
  }

  setVimKeys(given: readonly VimKey[]) {
    this.vimKeys = given;
  }
}
