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
    group: 'Review',
    keys: ['e'],
    targets: ['line', 'file'],
    overVim: true,
    when: { scope: ['diff', 'tree'], mode: 'normal' },
    menu: { on: 'file', order: 20 },
  },
  comment: {
    label: 'Comment',
    group: 'Review',
    keys: ['c'],
    targets: ['line'],
    when: { scope: 'diff' },
  },
  otherSide: {
    label: 'Other side',
    group: 'Review',
    keys: ['tab'],
    targets: ['line'],
    jump: true,
    when: { scope: 'diff' },
  },
  nextFile: { label: 'Next file', group: 'Go', keys: ['] f'], targets: ['line'], vim: 'motion' },
  copyLine: {
    label: 'Copy the line',
    group: 'Tabs',
    keys: ['y y'],
    targets: ['line'],
    when: { scope: ['diff', 'file'] },
  },
  copyLink: {
    label: 'Copy a link to it',
    group: 'Tabs',
    keys: ['y l'],
    targets: ['line'],
    when: { scope: ['diff', 'file'] },
  },
  inline: {
    label: 'Inline or side by side',
    group: 'View',
    keys: ['g i'],
    when: { scope: 'diff' },
  },
  expand: {
    label: 'Expand unchanged code',
    group: 'View',
    keys: ['z o'],
    when: { scope: 'diff' },
  },
  reply: {
    label: 'Reply',
    group: 'Comments',
    keys: ['r'],
    targets: ['thread'],
    when: { scope: 'diff' },
  },
});

export const vim = defineCommands('vim', {
  down: { label: 'Line down', group: 'Go', keys: ['j'], vim: 'own' },
  up: { label: 'Line up', group: 'Go', keys: ['k'], vim: 'own' },
  top: { label: 'Top', group: 'Go', keys: ['g g'], vim: 'own' },
});

export const review = defineCommands('review', {
  submit: { label: 'Submit review', group: 'Review', keys: ['cmd+enter'] },
  add: {
    label: 'Add to review',
    group: 'Comments',
    keys: ['cmd+enter'],
    when: { scope: 'box' },
  },
  now: { label: 'Comment now', group: 'Comments', keys: ['alt+enter'], when: { scope: 'box' } },
  preview: {
    label: 'Write or preview',
    group: 'Comments',
    keys: ['cmd+shift+v'],
    when: { scope: 'box' },
  },
  close: {
    label: 'Close and keep the draft',
    group: 'Comments',
    keys: ['esc esc'],
    when: { scope: 'box', mode: 'normal' },
  },
});

export const keys = defineCommands('keys', {
  help: { label: 'Every key', group: 'Tabs', keys: ['?'] },
  palette: { label: 'Every action', group: 'Go', keys: ['cmd+shift+p'] },
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
  tree: { label: 'Tree at this file', group: 'Go', keys: ['-'] },
  erase: { label: 'Never on its own', group: 'Go', keys: ['backspace'] },
  nextView: { label: 'Next view', group: 'View', keys: ['`'] },
});

export const tab = defineCommands('tab', {
  close: {
    label: 'Close the tab',
    group: 'Tabs',
    keys: ['cmd+w'],
    targets: ['tab', 'none'],
  },
  open: {
    label: 'Open a PR',
    group: 'Go',
    keys: ['cmd+l', { keys: 'cmd+o', on: 'mac' }],
  },
  install: {
    label: 'Install the command-line tool',
    group: 'Tabs',
    keys: ['cmd+shift+i'],
    when: { system: 'mac' },
  },
});

export const tree = defineCommands(
  'tree',
  {
    openAll: { label: 'Open all', group: 'Go', keys: ['z R'], when: { scope: 'tree' } },
    closeAll: { label: 'Close all', group: 'Go', keys: ['z M'], when: { scope: 'tree' } },
  },
  { scopes: ['tree'] },
);

export const palette = defineCommands('palette', {
  run: { label: 'Run', group: 'App', keys: ['enter'], when: { scope: 'palette' } },
  next: {
    label: 'Next',
    group: 'App',
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
      group: 'View',
      keys: ['] b'],
      targets: ['block', 'none'],
      repeat: true,
      when: { scope: 'overview' },
    },
    previousBlock: {
      label: 'Previous block',
      group: 'View',
      keys: ['[ b'],
      targets: ['block', 'none'],
      when: { scope: 'overview' },
    },
  },
  { scopes: ['overview'] },
);

export const all: readonly Declarations[] = [diff, vim, review, keys, tab, tree, palette, overview];

/**
 * A sequence for anywhere, over Vim in normal mode, as the merge queue's `g q` is. It isn't in
 * `all`, since a `g` for anywhere would change what the other tests see: a test adds it.
 */
export const queue = defineCommands('queue', {
  show: {
    label: 'Merge queue',
    group: 'Review',
    keys: ['g q'],
    overVim: true,
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
  },
});

/**
 * What a glossary's pieces run: a term's, on its row, and an overview's sections' and lines'. They
 * aren't in `all`, since their keys would change what the other tests see: a test adds them.
 */
export const terms = defineCommands('terms', {
  edit: { label: 'Edit term…', group: 'Review', keys: ['i'], targets: ['row'] },
  history: { label: 'Show history', group: 'Review', keys: [], targets: ['row'] },
  expand: { label: 'Expand term', group: 'Review', keys: ['enter'], targets: ['row'] },
  accept: { label: 'Accept suggestion', group: 'Review', keys: ['a'], targets: ['row'] },
  dismiss: { label: 'Dismiss suggestion', group: 'Review', keys: ['x'], targets: ['row'] },
});

export const sections = defineCommands('sections', {
  fold: { label: 'Collapse section', group: 'View', keys: ['z a'], targets: ['block'] },
  glossary: { label: 'Go to glossary', group: 'Go', keys: [] },
  stack: { label: 'Stack overview', group: 'Go', keys: ['g s'] },
});

/** A run of a command: its id and the target it got. */
export type Ran = readonly [string, Target];

/**
 * Every test command, and those `more` declares, each with a handler that records its runs in
 * `ran`. `vim.*` have none, as Vim's own keys have none.
 */
export function testCommands(ran: Ran[] = [], more: readonly Declarations[] = []): Command[] {
  return [...all, ...more].flatMap((declarations) =>
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
  /** The count Vim holds, when that's all it holds. */
  count: number | undefined = undefined;
  target: Target = { kind: 'line', at: { file: 'a.ts', side: 'new', line: 1 } };
  /** The view has no Vim, as with Vim keys off. */
  plain = false;
  vimKeys: readonly VimKey[] = [];
  readonly log: string[];

  constructor(log: string[] = []) {
    this.log = log;
  }

  keyState() {
    return {
      mode: this.mode,
      pending: this.pending,
      count: this.count,
      target: this.target,
      plain: this.plain,
    };
  }

  passKeys(held: readonly string[]) {
    this.log.push(`passKeys ${held.join(' ')}`);
    this.pending = true;
    this.count = undefined;
  }

  clearPending() {
    this.log.push('clearPending');
    this.pending = false;
    this.count = undefined;
  }

  setVimKeys(given: readonly VimKey[]) {
    this.vimKeys = given;
  }
}
