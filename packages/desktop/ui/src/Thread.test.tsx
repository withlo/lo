// @vitest-environment jsdom
// A review thread: open with its comments, collapsed to one line, pending, outdated, and the
// actions that show only where they apply: Edit and Delete on your own comments.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cleanUp, click, render } from '../test/dom.ts';
import { missingRules } from '../test/classes.ts';
import { SentPost, Thread, type ThreadComment, type ThreadProps } from './Thread.tsx';
import { ThreadPopover } from './ThreadPopover.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const MIRA: ThreadComment = {
  id: 'c1',
  author: 'mira-chen',
  when: '2 d ago',
  body: <p>Import order: the linter wants type imports last.</p>,
};
const RAVI: ThreadComment = {
  id: 'c2',
  author: 'ravi-k',
  when: '1 d ago',
  byAuthor: true,
  body: <p>Fixed in the next push.</p>,
};
const MINE: ThreadComment = {
  id: 'c3',
  author: 'tess-okafor',
  when: 'just now',
  mine: true,
  body: <p>Thanks, resolving.</p>,
};

const PROPS: ThreadProps = { comments: [MIRA, RAVI], resolved: false, open: true };

/** How many steps the row `element` is in has given up. */
function given(element: Element): number {
  const row = element.closest('[data-gave-up]');
  return (row?.getAttribute('data-gave-up') ?? '').split(' ').filter(Boolean).length;
}

/** The buttons whose label starts with `label`. */
function buttons(host: HTMLElement, label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')].filter((each) => each.textContent.startsWith(label));
}

// A thread's head row, the one row drawn with a border under it.
const headRow = (host: HTMLElement) => host.querySelector('.border-b');

describe('Thread', () => {
  it('shows an unresolved thread open: its state, its comments and the slots for their text', () => {
    const host = render(<Thread {...PROPS} />);
    const thread = host.querySelector('[role="group"]');
    expect(thread?.getAttribute('aria-label')).toBe('Unresolved thread by mira-chen');
    expect(thread?.textContent).toContain('Unresolved');
    expect(thread?.textContent).toContain('2 comments');
    expect(host.querySelector('[data-comment="c1"] p')?.textContent).toBe(
      'Import order: the linter wants type imports last.',
    );
    expect(host.querySelector('[data-comment="c2"]')?.textContent).toContain('Author');
    // Nothing on someone else's comments, and nothing to resolve or reply with unless allowed.
    expect(buttons(host, 'Edit')).toHaveLength(0);
    expect(buttons(host, 'Delete')).toHaveLength(0);
    expect(buttons(host, 'Resolve')).toHaveLength(0);
    expect(host.textContent).not.toContain('Reply…');
  });

  it('draws without a comment a box under it is editing, and still counts it', () => {
    const host = render(
      <Thread {...PROPS} comments={[MIRA, RAVI, MINE]} editing={new Set(['c3'])} canReply />,
    );
    expect(host.querySelector('[data-comment="c3"]')).toBeNull();
    expect(host.querySelector('[data-comment="c2"]')).not.toBeNull();
    expect(host.textContent).toContain('3 comments');
  });

  it('collapses a resolved thread to one line, and opens it from there', () => {
    const onToggle = vi.fn<() => void>();
    const host = render(
      <Thread
        {...PROPS}
        resolved
        open={false}
        excerpt="Import order: the linter wants type imports last."
        onToggle={onToggle}
      />,
    );
    const line = host.querySelector('button');
    for (const part of [
      'Resolved',
      'mira-chen',
      'Import order: the linter wants type imports last.',
      '1 reply',
    ]) {
      expect(line?.textContent).toContain(part);
    }
    expect(line?.getAttribute('aria-expanded')).toBe('false');
    // Only the line, and the mouse's own way to open it: none of the comments are drawn.
    expect(host.querySelectorAll('button:not([aria-hidden])')).toHaveLength(1);
    expect(host.querySelector('[data-comment]')).toBeNull();
    click(line!);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('says a resolved thread that is open is resolved, and offers to unresolve it', () => {
    const onResolve = vi.fn<() => void>();
    const host = render(
      <Thread {...PROPS} resolved canResolve keys={{ resolve: ['x'] }} onResolve={onResolve} />,
    );
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Resolved thread by mira-chen',
    );
    const [unresolve] = buttons(host, 'Unresolve');
    // Its key's chip, and what it says while GitHub hasn't answered.
    expect(unresolve?.textContent).toBe('UnresolvexResolving…');
    expect(unresolve?.getAttribute('aria-busy')).toBeNull();
    click(unresolve!);
    expect(onResolve).toHaveBeenCalledOnce();
    expect(buttons(host, 'Resolve')).toHaveLength(0);
  });

  it('shows what was asked for at once, with the control at work until GitHub answers', () => {
    const onResolve = vi.fn<() => void>();
    const host = render(
      <Thread
        {...PROPS}
        resolved
        resolving
        canResolve
        keys={{ resolve: ['x'] }}
        onResolve={onResolve}
      />,
    );
    const [unresolve] = buttons(host, 'Unresolve');
    expect(unresolve?.getAttribute('aria-busy')).toBe('true');
    click(unresolve!);
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('marks the open card as the scope its repeated controls’ key chips show in', () => {
    const host = render(<Thread {...PROPS} focused canResolve keys={{ resolve: ['x'] }} />);
    const card = host.querySelector('[data-key-scope]');
    expect(card?.hasAttribute('data-focused')).toBe(true);
    expect(card?.querySelector('.key-focus kbd')?.textContent).toBe('x');
  });

  it('draws a sent comment as its card will, with what’s being done where its time will be', () => {
    const host = render(<SentPost author="tess-okafor" body={<p>On its way</p>} />);
    const sent = host.querySelector('[data-sent]');
    expect(sent?.textContent).toContain('tess-okafor (you)');
    expect(sent?.textContent).toContain('Sending…');
    expect(sent?.textContent).toContain('On its way');
    expect(render(<SentPost label="Saving…" body="x" />).textContent).toContain('Saving…');
  });

  it('draws a new thread’s sent comment under the head row its thread will have', () => {
    const sent = render(<SentPost state="Pending" author="tess-okafor" body={<p>On its way</p>} />);
    const thread = render(
      <Thread {...PROPS} comments={[{ ...MINE, pending: true, body: <p>On its way</p> }]} />,
    );
    // The same row, by the same classes, with the same words.
    expect(headRow(sent)?.className).toBe(headRow(thread)?.className);
    expect(headRow(sent)?.textContent).toBe('Pending1 comment');
    expect(headRow(thread)?.textContent).toContain('Pending1 comment');
    expect(sent.querySelector('[data-sent]')?.previousElementSibling).toBe(headRow(sent));
  });

  it('draws a thread in your pending review by its Pending tag alone', () => {
    const pending: ThreadComment = { ...MINE, id: 'p1', pending: true };
    const host = render(<Thread {...PROPS} comments={[pending]} canResolve />);
    const thread = host.querySelector('[role="group"]');
    expect(thread?.getAttribute('aria-label')).toBe('Pending thread by tess-okafor');
    expect(thread?.textContent).toContain('Pending');
    expect(thread?.textContent).toContain('1 comment');
    expect(thread?.textContent).not.toContain('Unresolved');
    // There's nothing on GitHub to resolve yet.
    expect(buttons(host, 'Resolve')).toHaveLength(0);
    // No stripe or gradient marks it: the tag says it.
    expect(host.innerHTML).not.toMatch(/border-(?:l|s)-|gradient/);
  });

  it('tags a pending reply in a thread GitHub already has, and counts it', () => {
    const reply: ThreadComment = { ...MINE, id: 'p1', pending: true };
    const host = render(<Thread {...PROPS} comments={[MIRA, reply]} />);
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Unresolved thread by mira-chen',
    );
    expect(host.textContent).toContain('2 comments, 1 pending');
    expect(host.querySelector('[data-comment="p1"]')?.textContent).toContain('Pending');
    expect(host.querySelector('[data-comment="c1"]')?.textContent).not.toContain('Pending');
  });

  it('tags an outdated thread, and any other tag it is given', () => {
    const host = render(
      <Thread {...PROPS} outdated tags={[{ label: 'On a newer push', tone: 'warning' }]} />,
    );
    const head = host.querySelector('[role="group"] > div');
    expect(head?.textContent).toContain('Out of date');
    expect(head?.textContent).toContain('On a newer push');
  });

  it('offers Edit and Delete on your own comments only, with their keys on your newest', () => {
    const older: ThreadComment = { ...MINE, id: 'm1', when: '3 d ago' };
    const newest: ThreadComment = { ...MINE, id: 'm2' };
    const onEdit = vi.fn<(id: string) => void>();
    const onDelete = vi.fn<(id: string) => void>();
    const host = render(
      <Thread
        {...PROPS}
        comments={[MIRA, older, RAVI, newest]}
        keys={{ edit: ['i'], delete: ['d', 'd'] }}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    const edits = buttons(host, 'Edit');
    const deletes = buttons(host, 'Delete');
    expect(edits).toHaveLength(2);
    expect(deletes).toHaveLength(2);
    // They're inside your comments, and no one else's.
    expect(
      edits.every((each) => each.closest('[data-comment]')?.textContent.includes('(you)')),
    ).toBe(true);
    expect(host.querySelector('[data-comment="c1"]')?.textContent).not.toContain('Edit');
    expect(host.querySelector('[data-comment="c2"]')?.textContent).not.toContain('Delete');
    // The keys act on the newest of yours, so only its buttons show them.
    expect(edits.map((each) => each.textContent)).toEqual(['Edit', 'Editi']);
    // Each also holds what it says while its delete is on its way.
    expect(deletes.map((each) => each.textContent)).toEqual([
      'Delete…Deleting…',
      'Delete…ddDeleting…',
    ]);
    click(edits[0]!);
    click(deletes[1]!);
    expect(onEdit).toHaveBeenCalledWith('m1');
    expect(onDelete).toHaveBeenCalledWith('m2');
  });

  it('offers a reply where it can be made, and shows an open reply box in its place', () => {
    const onReply = vi.fn<() => void>();
    const host = render(<Thread {...PROPS} canReply keys={{ reply: ['r'] }} onReply={onReply} />);
    const [reply] = buttons(host, 'Reply');
    // Its key's chip shows only on the card the keyboard is on; elsewhere it's in the tooltip.
    expect(reply?.textContent).toBe('Replyr');
    click(reply!);
    expect(onReply).toHaveBeenCalledOnce();

    const open = render(
      <Thread {...PROPS} canReply reply={<div data-testid="box">the reply box</div>} />,
    );
    expect(open.querySelector('[data-testid="box"]')?.textContent).toBe('the reply box');
    expect(buttons(open, 'Reply')).toHaveLength(0);
  });

  it('has a "More actions" button where a right-click opens a menu, which opens that menu', () => {
    expect(
      render(<Thread {...PROPS} />).querySelector('button[aria-label="More actions"]'),
    ).toBeNull();
    const host = render(<Thread {...PROPS} menu />);
    const asked: MouseEvent[] = [];
    host.addEventListener('contextmenu', (event) => asked.push(event));
    click(host.querySelector('button[aria-label="More actions"]')!);
    expect(asked).toHaveLength(1);
  });

  it('collapses from its head, with the key in the tooltip, and rings the thread the keyboard is on', () => {
    const onToggle = vi.fn<() => void>();
    const host = render(
      <Thread {...PROPS} focused keys={{ toggle: ['z', 'a'] }} onToggle={onToggle} />,
    );
    const collapse = host.querySelector('button[aria-label="Collapse thread"]');
    expect(collapse?.getAttribute('aria-description')).toBe('Keys z then a');
    click(collapse!);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="group"]')?.hasAttribute('data-focused')).toBe(true);
  });

  it('gives up what a narrow comment head draws, in order, until the name is whole', () => {
    // The name takes 120 px. Each step given up gives it more room: none, the key chips, the
    // "Author" tag, then the controls' words, which is enough.
    const room = [40, 60, 90, 130, 160];
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-fit') ? room[given(this)] : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-fit') ? 120 : 0;
      },
    });
    try {
      const host = render(<Thread {...PROPS} comments={[{ ...MINE, byAuthor: true }]} />);
      const head = host.querySelector('[data-fit]')?.parentElement?.parentElement;
      expect(head?.getAttribute('data-gave-up')).toBe('keys tag labels');
      // Each control is its icon then, with its words as its tooltip, and keeps its name.
      const [edit] = buttons(host, 'Edit');
      expect(edit?.getAttribute('aria-label')).toBe('Edit comment from just now');
      expect(edit?.querySelector('[data-takes="labels"] svg')).not.toBeNull();
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    }
  });

  it('draws nothing for a thread with no comments', () => {
    expect(render(<Thread {...PROPS} comments={[]} />).innerHTML).toBe('');
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <>
        <Thread
          {...PROPS}
          comments={[MIRA, MINE]}
          outdated
          canResolve
          canReply
          focused
          keys={{ resolve: ['x'], reply: ['r'], edit: ['i'], delete: ['d', 'd'] }}
        />
        <Thread {...PROPS} resolved open={false} excerpt="Import order" />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});

describe('Thread in a popover', () => {
  const popover = (focused: boolean) => (
    <Thread
      {...PROPS}
      variant="popover"
      lines="Lines 10–35"
      focused={focused}
      canResolve
      keys={{ resolve: ['x'] }}
      onResolve={() => {}}
      onClose={() => {}}
      closeKeys={['esc']}
    />
  );

  it('has no card of its own: a head of one line, its lines and count, over its comments', () => {
    const host = render(popover(false));
    const thread = host.querySelector('[role="group"]')!;
    expect(thread.querySelector('[data-pop-head]')?.textContent).toContain('Lines 10–35');
    expect(thread.querySelector('[data-pop-head]')?.textContent).toContain('2 comments');
    // Its comments are where the ring goes, which `j` and `k` move.
    expect(
      [...thread.querySelectorAll('[data-comment]')].map((each) => each.getAttribute('tabindex')),
    ).toEqual(['-1', '-1']);
    expect(thread.querySelector('[aria-label="Collapse thread"]')).toBeNull();
  });

  it('keeps the room of its Close and key chips in a preview, which pinning shows', () => {
    const preview = render(popover(false));
    const hidden = preview.querySelector('[aria-label="Close thread"]')!;
    expect(hidden.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(hidden.getAttribute('tabindex')).toBe('-1');
    expect(preview.querySelector('[data-key-room]')).not.toBeNull();
    cleanUp();
    const pinned = render(popover(true));
    const close = pinned.querySelector('[aria-label="Close thread"]')!;
    expect(close.closest('[aria-hidden="true"]')).toBeNull();
    expect(close.hasAttribute('tabindex')).toBe(false);
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <ThreadPopover
        label="Unresolved thread · lines 10–35"
        threads={[
          { id: 'one', card: popover(true) },
          { id: 'two', card: <Thread {...PROPS} resolved variant="popover" lines="Line 35" /> },
        ]}
      />,
    );
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Unresolved thread · lines 10–35',
    );
    expect(await missingRules(host)).toEqual([]);
  });
});
