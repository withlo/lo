// @vitest-environment jsdom
import {
  defineCommands,
  handlers,
  KEY_EVENT,
  parseKeys,
  Registry,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  systemStrokes,
  type Target,
} from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import { barItems, runFromBar } from './bar.ts';
import { systemOf } from './registry.ts';

const declarations = defineCommands('view', {
  inline: {
    label: 'Inline or side by side',
    group: 'View',
    keys: ['g i'],
    bar: { menu: 'View', section: 'diff', order: 10 },
  },
  threads: {
    label: 'Threads panel',
    group: 'View',
    keys: ['cmd+shift+\\'],
    targets: ['file'],
    bar: { menu: 'View', section: 'diff', order: 20 },
  },
  hidden: { label: 'Not in a menu', group: 'View', keys: ['cmd+k'] },
});
const commands = handlers(declarations, {
  inline: { run() {} },
  threads: { run() {} },
  hidden: { run() {} },
});

/** A keydown of `text`, in Lo's notation, as the listener hands it to the registry. */
function key(text: string) {
  return { strokes: systemStrokes(parseKeys(text), 'mac'), repeat: false, composing: false };
}

describe('the app menu’s items', () => {
  const none: Target = { kind: 'none' };

  it('list the commands that declare a menu, with a key only when it’s a single chord', () => {
    const registry = new Registry({ system: 'mac', commands });
    expect(barItems(registry, { kind: 'file', file: 'a.ts' })).toEqual([
      {
        id: 'view.inline',
        label: 'Inline or side by side',
        menu: 'View',
        section: 'diff',
        order: 10,
        enabled: true,
      },
      {
        id: 'view.threads',
        label: 'Threads panel',
        menu: 'View',
        section: 'diff',
        order: 20,
        key: { key: '\\', meta: true, ctrl: false, alt: false, shift: true },
        enabled: true,
      },
    ]);
  });

  it('say whether each can run on what has focus', () => {
    const registry = new Registry({ system: 'mac', commands });
    expect(barItems(registry, none).map((item) => item.enabled)).toEqual([true, false]);
  });

  it('name code plainly, since a menu can’t set it apart', () => {
    const install = handlers(
      defineCommands('open', {
        installCommand: {
          label: 'Install `lo` command',
          group: 'Tabs',
          keys: [],
          bar: { menu: 'App', section: 'app', order: 10 },
        },
      }),
      { installCommand: { run() {} } },
    );
    const registry = new Registry({ system: 'mac', commands: install });
    expect(barItems(registry, none).map((item) => item.label)).toEqual(['Install lo command']);
  });

  it('can none run while a right-click menu is open over the window', () => {
    const registry = new Registry({ system: 'mac', commands });
    expect(
      barItems(registry, { kind: 'file', file: 'a.ts' }, true).map((item) => item.enabled),
    ).toEqual([false, false]);
  });

  it('show the keys the keymap gives, in the system’s keys', () => {
    const registry = new Registry({ system: 'linux', commands });
    registry.setKeymap('bind ctrl+alt+t view.threads\nunbind cmd+shift+\\');
    expect(barItems(registry, none)[1]?.key).toEqual({
      key: 't',
      meta: false,
      ctrl: true,
      alt: true,
      shift: false,
    });
  });
});

describe('a switch or a choice in the app menu', () => {
  const layout = { value: 'split' };
  const toggles = defineCommands('diff', {
    split: {
      label: 'Side by side',
      group: 'View',
      keys: ['g s'],
      toggle: 'choice',
      bar: { menu: 'View', section: 'diff', order: 10 },
    },
    inline: {
      label: 'Inline',
      group: 'View',
      keys: ['g i'],
      toggle: 'choice',
      bar: { menu: 'View', section: 'diff', order: 20 },
    },
    quit: {
      label: 'Quit',
      group: 'App',
      keys: ['ctrl+q'],
      when: { system: 'linux' },
      bar: { menu: 'File', section: 'quit', order: 10 },
    },
  });
  const ran: string[] = [];
  const registry = new Registry({
    system: 'mac',
    commands: handlers(toggles, {
      split: { run: () => void ran.push('split'), checked: () => layout.value === 'split' },
      inline: { run: () => void ran.push('inline'), checked: () => layout.value === 'inline' },
      quit: { run() {} },
    }),
  });

  it('says whether it’s checked, and leaves out a command for the other system', () => {
    expect(
      barItems(registry, { kind: 'none' }).map(({ id, toggle, checked }) => [id, toggle, checked]),
    ).toEqual([
      ['diff.split', 'choice', true],
      ['diff.inline', 'choice', false],
    ]);
  });

  it('does nothing when the choice clicked is already chosen', () => {
    expect(runFromBar(registry, 'diff.split', { kind: 'none' })).toBe(true);
    expect(ran).toEqual([]);
    expect(runFromBar(registry, 'diff.inline', { kind: 'none' })).toBe(true);
    expect(ran).toEqual(['inline']);
  });
});

describe('a click in the app menu', () => {
  it('runs only a command the menu lists', () => {
    const ran: string[] = [];
    const registry = new Registry({
      system: 'mac',
      commands: handlers(declarations, {
        inline: { run: () => void ran.push('inline') },
        threads: { run: () => void ran.push('threads') },
        hidden: { run: () => void ran.push('hidden') },
      }),
    });
    expect(runFromBar(registry, 'view.inline', { kind: 'none' })).toBe(true);
    expect(runFromBar(registry, 'view.hidden', { kind: 'none' })).toBe(
      "view.hidden isn't in the app menu.",
    );
    expect(runFromBar(registry, 'view.missing', { kind: 'none' })).toBe(
      "view.missing isn't in the app menu.",
    );
    // Still only where it can run.
    expect(runFromBar(registry, 'view.threads', { kind: 'none' })).toBe(
      "Threads panel doesn't apply here.",
    );
    expect(ran).toEqual(['inline']);
  });

  it('is the reader’s input: the focused element hears it, as a key the registry takes, before it runs', () => {
    const ran: string[] = [];
    const registry = new Registry({
      system: 'mac',
      commands: handlers(declarations, {
        inline: { run: () => void ran.push('inline') },
        threads: { run: () => void ran.push('threads') },
        hidden: { run: () => void ran.push('hidden') },
      }),
    });
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    const heard: string[] = [];
    document.body.addEventListener(KEY_EVENT, (event) => {
      heard.push(`${event.target === field ? 'field' : 'elsewhere'}, ${ran.length} run`);
    });
    runFromBar(registry, 'view.inline', { kind: 'none' });
    // One the menu doesn't list is nothing the reader did.
    runFromBar(registry, 'view.hidden', { kind: 'none' });
    expect(heard).toEqual(['field, 0 run']);
    expect(ran).toEqual(['inline']);
    field.remove();
  });

  it('drops the keys held for a sequence, as a click in the page does', () => {
    const ran: string[] = [];
    const registry = new Registry({
      system: 'mac',
      commands: handlers(declarations, {
        inline: { run: () => void ran.push('inline') },
        threads: { run: () => void ran.push('threads') },
        hidden: { run: () => void ran.push('hidden') },
      }),
    });
    const place = {
      scope: { name: 'window', element: undefined, source: undefined },
      text: undefined,
    };
    // `g` of `g i`, then a command from the menu: `i` is no longer the end of `g i`.
    expect(registry.handle(key('g'), place).kind).toBe('stop');
    runFromBar(registry, 'view.threads', { kind: 'file', file: 'a.ts' });
    expect(registry.isPending()).toBe(false);
    expect(registry.handle(key('i'), place).kind).toBe('pass');
    expect(ran).toEqual(['threads']);
  });
});

/** A diff on the page, whose cursor is at `target`, until the function it gives is called. */
function diffAt(target: Target, inert = false): () => void {
  const holder = document.createElement('div');
  if (inert) holder.setAttribute('inert', '');
  const diff = document.createElement('div');
  diff.setAttribute(SCOPE_ATTRIBUTE, 'diff');
  holder.append(diff);
  document.body.append(holder);
  const stop = setScopeSource(diff, { target: () => target });
  return () => {
    stop();
    holder.remove();
  };
}

describe('a step the app menu shares with a key in the diff', () => {
  const steps = defineCommands('diff', {
    nextFile: {
      label: 'Next file',
      group: 'Go',
      keys: ['] f'],
      targets: ['line'],
      vim: 'motion',
      when: { scope: 'diff' },
      bar: { menu: 'Go', section: 'steps', order: 30 },
    },
  });
  const ran: Target[] = [];
  const registry = new Registry({
    system: 'mac',
    commands: handlers(steps, { nextFile: { run: (target) => void ran.push(target) } }),
  });
  const none: Target = { kind: 'none' };
  const header: Target = { kind: 'header', file: 'b.ts', side: 'new' };
  const line: Target = { kind: 'line', at: { file: 'a.ts', side: 'new', line: 4 } };

  const enabled = (focused: Target) => barItems(registry, focused)[0]?.enabled;

  it('can run from a file’s header, as its key goes from one as from a line', () => {
    ran.length = 0;
    expect(enabled(header)).toBe(true);
    expect(runFromBar(registry, 'diff.nextFile', header)).toBe(true);
    expect(ran).toEqual([header]);
  });

  it('goes from the diff’s cursor with focus outside it, as its key would there', () => {
    ran.length = 0;
    const gone = diffAt(line);
    expect(enabled(none)).toBe(true);
    expect(runFromBar(registry, 'diff.nextFile', none)).toBe(true);
    expect(ran).toEqual([line]);
    gone();
    // With the cursor on a header, too.
    const onHeader = diffAt(header);
    expect(enabled(none)).toBe(true);
    onHeader();
  });

  it('can’t run with no diff on screen: none, or one kept hidden under another view', () => {
    ran.length = 0;
    expect(enabled(none)).toBe(false);
    const hidden = diffAt(line, true);
    expect(enabled(none)).toBe(false);
    expect(runFromBar(registry, 'diff.nextFile', none)).toBe("Next file doesn't apply here.");
    hidden();
    expect(ran).toEqual([]);
  });
});

it('tells the system from the browser’s platform', () => {
  expect(systemOf('MacIntel')).toBe('mac');
  expect(systemOf('Linux x86_64')).toBe('linux');
});
