// @vitest-environment jsdom
// An overview note, in a popover over the code and as a card under its line: its head, its words,
// "Show in overview", and its Close or its collapse.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { testCommands, type Ran } from '../test/commands.ts';
import { cleanUp, click, render } from '../test/dom.ts';
import { holdRegistry } from './commands/control.ts';
import { Registry } from './commands/registry.ts';
import type { LineTarget } from './commands/targets.ts';
import { CLOSE_NOTE, Note } from './Note.tsx';
import { ThreadPopover } from './ThreadPopover.tsx';

const LINE: LineTarget = { kind: 'line', at: { file: 'a.ts', side: 'new', line: 15 } };

let release: (() => void) | undefined;

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
  release?.();
  release = undefined;
});

/** The engine's test commands, held as the window's: "Show in overview" stands in as Comment. */
function held(): Ran[] {
  const ran: Ran[] = [];
  release = holdRegistry(new Registry({ system: 'mac', commands: testCommands(ran) }));
  return ran;
}

const PROPS = {
  label: 'Overview note, lines 2–15',
  section: 'How it works',
  lines: 'Lines 2–15',
  show: { command: 'diff.comment', target: LINE },
  children: <p>Lines wrap at the pane’s width.</p>,
};

describe('Note', () => {
  it('in a popover, says what it is in one row, and its words under it', () => {
    held();
    const host = render(<Note {...PROPS} variant="popover" onClose={() => {}} />);
    const note = host.querySelector('[role="group"]')!;
    expect(note.getAttribute('aria-label')).toBe('Overview note, lines 2–15');
    const head = note.querySelector('[data-pop-head]')!;
    expect(head.classList.contains('give-up')).toBe(true);
    expect(head.textContent).toContain('OverviewLines 2–15How it works');
    expect(note.querySelector('[data-note-text]')?.textContent).toBe(
      'Lines wrap at the pane’s width.',
    );
    // The section goes first as it narrows, and the lines are cut only after the rest.
    expect(note.querySelector('[data-gives="detail"]')?.textContent).toBe('How it works');
    expect(note.querySelector('[data-fit]')?.textContent).toBe('Lines 2–15');
  });

  it('previewed, keeps the room of its Close and key chips, which pinned shows', () => {
    held();
    const onClose = vi.fn<() => void>();
    const preview = render(<Note {...PROPS} variant="popover" onClose={onClose} />);
    expect(preview.querySelector('[data-key-room]')).not.toBeNull();
    const hidden = preview.querySelector<HTMLElement>(`[aria-label="${CLOSE_NOTE}"]`)!;
    expect(hidden.closest('.invisible')).not.toBeNull();
    expect(hidden.tabIndex).toBe(-1);
    // "Show in overview" gives up its words for its icon, keeping its name.
    const show = preview.querySelector<HTMLElement>('button[data-squares="labels"]')!;
    expect(show.getAttribute('aria-label')).toBe('Show in overview');
    expect(show.querySelector('[data-gives="labels"]')?.textContent).toBe('Show in overview');
    expect(show.querySelector('.key-focus')).not.toBeNull();
    cleanUp();
    const pinned = render(<Note {...PROPS} variant="popover" focused onClose={onClose} />);
    const close = pinned.querySelector<HTMLElement>(`[aria-label="${CLOSE_NOTE}"]`)!;
    expect(close.closest('.invisible')).toBeNull();
    expect(pinned.querySelector('[data-focused]')).not.toBeNull();
    click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('“Show in overview” runs its command on the note', () => {
    const ran = held();
    const host = render(<Note {...PROPS} variant="popover" />);
    click(host.querySelector<HTMLElement>('button[data-squares="labels"]')!);
    expect(ran).toEqual([['diff.comment', LINE]]);
  });

  it('as a card, says its lines only when given them, and its collapse closes it', () => {
    held();
    const onClose = vi.fn<() => void>();
    const host = render(<Note {...PROPS} onClose={onClose} />);
    expect(host.querySelector('[data-pop-head]')).toBeNull();
    expect(host.textContent).toContain('Lines 2–15');
    expect(render(<Note {...PROPS} lines={undefined} />).textContent).not.toContain('Lines 2–15');
    const collapse = host.querySelector<HTMLElement>(`[aria-label="${CLOSE_NOTE}"]`)!;
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    click(collapse);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('in a popover, two are a hairline apart, each marked as its note’s', () => {
    held();
    const host = render(
      <ThreadPopover
        label="2 overview notes, lines 2–15"
        threads={[]}
        notes={[
          { key: 'n1', card: <Note {...PROPS} variant="popover" /> },
          { key: 'n2', card: <Note {...PROPS} variant="popover" lines="Lines 9–15" /> },
        ]}
      />,
    );
    const notes = host.querySelectorAll<HTMLElement>('[data-note-key]');
    expect([...notes].map((note) => note.dataset.noteKey)).toEqual(['n1', 'n2']);
    expect(notes[0]!.className).toBe('');
    expect(notes[1]!.className).toContain('border-t');
    // With no Close of its own, the second keeps its room, so its "Show in overview" lines up.
    const room = notes[1]!.querySelector('[data-pop-head] [aria-hidden="true"].w-control-h-sm');
    expect(room).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      '2 overview notes, lines 2–15',
    );
  });

  it('has a rule for every class it draws', async () => {
    held();
    const host = render(
      <>
        <Note {...PROPS} variant="popover" focused onClose={() => {}} />
        <Note {...PROPS} focused onClose={() => {}} />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});
