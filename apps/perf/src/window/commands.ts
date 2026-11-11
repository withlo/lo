// The commands the suite drives, with the diff feature's keys and ids, and the registry's history
// keys: the same key path the app has, through `@lo/ui/commands`. In a code view, Vim runs Lo's
// jumps under these keys; their handlers run from anywhere else.

import type { Composer, DiffView, Place, Span } from '@lo/ui/code';
import {
  defineCommands,
  type Entry,
  handlers,
  type LineTarget,
  type Registry,
  type Target,
} from '@lo/ui/commands';

export const diffKeys = defineCommands('diff', {
  nextChange: {
    label: 'Next change',
    group: 'Jump',
    keys: ['] c'],
    targets: ['line'],
    vim: 'motion',
    when: { scope: 'diff' },
  },
  previousChange: {
    label: 'Previous change',
    group: 'Jump',
    keys: ['[ c'],
    targets: ['line'],
    vim: 'motion',
    when: { scope: 'diff' },
  },
  nextFile: {
    label: 'Next file',
    group: 'Jump',
    keys: ['] f'],
    targets: ['line'],
    vim: 'motion',
    when: { scope: 'diff' },
  },
  previousFile: {
    label: 'Previous file',
    group: 'Jump',
    keys: ['[ f'],
    targets: ['line'],
    vim: 'motion',
    when: { scope: 'diff' },
  },
  nextThread: {
    label: 'Next thread',
    group: 'Jump',
    keys: ['] t'],
    targets: ['line'],
    vim: 'motion',
    when: { scope: 'diff' },
  },
  previousThread: {
    label: 'Previous thread',
    group: 'Jump',
    keys: ['[ t'],
    targets: ['line'],
    vim: 'motion',
    when: { scope: 'diff' },
  },
  otherSide: {
    label: 'The other side',
    group: 'Diff view',
    keys: ['tab'],
    when: { scope: 'diff', mode: 'normal' },
  },
  openRun: {
    label: 'Open unchanged lines',
    group: 'Diff view',
    keys: ['z o'],
    targets: ['line'],
    overVim: true,
    when: { scope: 'diff', mode: 'normal' },
  },
  closeRun: {
    label: 'Close unchanged lines',
    group: 'Diff view',
    keys: ['z c'],
    targets: ['line'],
    overVim: true,
    when: { scope: 'diff', mode: 'normal' },
  },
  openFile: {
    label: 'Open every unchanged line in the file',
    group: 'Diff view',
    keys: ['z R'],
    targets: ['line'],
    overVim: true,
    when: { scope: 'diff', mode: 'normal' },
  },
  toggleFile: {
    label: 'Load, close or open the file',
    group: 'Diff view',
    keys: ['z a'],
    targets: ['line'],
    overVim: true,
    when: { scope: 'diff', mode: 'normal' },
  },
  inline: {
    label: 'Inline or side by side',
    group: 'Diff view',
    keys: ['g i'],
    overVim: true,
    when: { scope: 'diff', mode: 'normal' },
  },
  comment: {
    label: 'Comment',
    group: 'Threads',
    keys: ['c'],
    targets: ['line'],
    overVim: true,
    when: { scope: 'diff', mode: ['normal', 'visual'] },
  },
  copyLink: {
    label: "Copy the line's link",
    group: 'Copy and open',
    keys: ['y l'],
    targets: ['line'],
    when: { scope: 'diff', mode: 'normal' },
  },
});

export const historyKeys = defineCommands('keys', {
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
});

/** What the commands act through: the view, once it's open, and what the page does for them. */
export interface Suite {
  view(): DiffView;
  registry(): Registry;
  /** Where the tab is: the place a jump leaves. */
  here(): Entry | undefined;
  /** Opens a comment box at a line or the lines `v` selected. */
  compose(at: Place | Span): Composer;
  copyLink(place: Place): void;
}

/** The place a line target is at: the cursor's line, or the last line `v` selected. */
function placeOf(target: LineTarget): Place {
  const { at } = target;
  return 'line' in at ? at : { file: at.file, side: at.side, line: Math.max(at.from, at.to) };
}

/** A line of a file, not its header. */
function onALine(target: Target): true | string {
  if (target.kind !== 'line') return 'Put the cursor on a line.';
  return placeOf(target).line > 0 ? true : 'Put the cursor on a line, not the header.';
}

export function commandsFor(suite: Suite) {
  const jump = (to: 'change' | 'file' | 'thread', count: number) => (): void =>
    suite.view().jump(to, count);
  const fold = (how: 'open' | 'close' | 'file' | 'toggle') => (target: LineTarget) =>
    suite.view().fold(placeOf(target), how);
  return [
    ...handlers(diffKeys, {
      nextChange: { run: jump('change', 1) },
      previousChange: { run: jump('change', -1) },
      nextFile: { run: jump('file', 1) },
      previousFile: { run: jump('file', -1) },
      nextThread: { run: jump('thread', 1) },
      previousThread: { run: jump('thread', -1) },
      otherSide: { run: () => suite.view().otherSide() },
      openRun: { run: fold('open'), enabled: onALine },
      closeRun: { run: fold('close'), enabled: onALine },
      openFile: { run: fold('file') },
      toggleFile: { run: fold('toggle') },
      inline: {
        run() {
          const view = suite.view();
          view.setLayout(view.probe.layout === 'split' ? 'inline' : 'split');
        },
      },
      comment: {
        run(target) {
          suite.compose(target.at);
        },
        enabled: onALine,
      },
      copyLink: { run: (target) => suite.copyLink(placeOf(target)), enabled: onALine },
    }),
    ...handlers(historyKeys, {
      back: {
        run() {
          suite.registry().history.back(suite.here());
        },
      },
      forward: {
        run() {
          suite.registry().history.forward();
        },
      },
    }),
  ];
}
