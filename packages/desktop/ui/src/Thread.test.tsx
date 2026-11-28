// @vitest-environment jsdom
// A review thread: open with its comments, collapsed to one line, pending, outdated, and the
// actions that show only where they apply: a `⋯` of its own on each of your comments.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cleanUp, click, render } from '../test/dom.ts';
import { missingRules } from '../test/classes.ts';
import { SentPost, Thread, type ThreadComment, type ThreadProps } from './Thread.tsx';
import { ringComment, ThreadPopover } from './ThreadPopover.tsx';

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
    expect(host.querySelectorAll('[data-comment] button')).toHaveLength(0);
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
    expect(render(<SentPost byAuthor author="ravi-k" body="x" />).textContent).toContain('Author');
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

  it('draws a sent reply over the row its card will have that offers a reply, which takes nothing', () => {
    const sent = render(<SentPost reply author="tess-okafor" body={<p>On its way</p>} />);
    const thread = render(<Thread {...PROPS} canReply onReply={() => {}} />);
    const row = sent.querySelector('[data-sent]')?.nextElementSibling;
    const [reply] = buttons(thread, 'Reply');
    // The same row, by the same classes: nothing moves as the card takes the comment's place.
    expect(row?.className).toBe(reply?.parentElement?.className);
    expect(row?.textContent).toBe('Reply');
    expect(row?.firstElementChild?.hasAttribute('inert')).toBe(true);
    expect(buttons(sent, 'Reply')).toHaveLength(0);
  });

  it('draws a sent edit as its text alone, for a card whose head says it’s being saved', () => {
    const host = render(
      <SentPost bare label="Saving…" author="tess-okafor" body={<p>New text</p>} />,
    );
    expect(host.querySelector('[data-sent]')?.textContent).toBe('New text');
    expect(host.textContent).not.toContain('Saving…');
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

  it('gives each of your comments a `⋯` of its own, which opens the menu of a right-click on it', () => {
    const older: ThreadComment = { ...MINE, id: 'm1', when: '3 d ago' };
    const newest: ThreadComment = { ...MINE, id: 'm2' };
    const comments = [MIRA, older, RAVI, newest];
    // Where the thread has no menu, there's none.
    expect(
      render(<Thread {...PROPS} comments={comments} />).querySelectorAll('[data-comment] button'),
    ).toHaveLength(0);
    cleanUp();
    const host = render(<Thread {...PROPS} comments={comments} menu />);
    const mores = [...host.querySelectorAll<HTMLButtonElement>('[data-comment] button')];
    // Named for its comment, in your comments, and no one else's: no Edit or Delete drawn.
    expect(mores.map((each) => each.getAttribute('aria-label'))).toEqual([
      'More actions for comment from 3 d ago',
      'More actions for comment from just now',
    ]);
    expect(
      mores.map((each) => each.closest('[data-comment]')?.getAttribute('data-comment')),
    ).toEqual(['m1', 'm2']);
    expect(buttons(host, 'Edit')).toHaveLength(0);
    expect(buttons(host, 'Delete')).toHaveLength(0);
    // Only your comments are where it shows, under the pointer or with focus in them.
    expect(
      [...host.querySelectorAll('[data-shy-scope]')].map((each) =>
        each.getAttribute('data-comment'),
      ),
    ).toEqual(['m1', 'm2']);
    // A click opens the menu a right-click on that comment opens.
    const asked: (string | null | undefined)[] = [];
    host.addEventListener('contextmenu', (event) => {
      if (event.target instanceof Element) {
        asked.push(event.target.closest('[data-comment]')?.getAttribute('data-comment'));
      }
    });
    click(mores[0]!);
    expect(asked).toEqual(['m1']);
  });

  it('shows the `⋯` of your newest comment on a card the keyboard is on, which its keys act on', () => {
    const older: ThreadComment = { ...MINE, id: 'm1', when: '3 d ago' };
    const newest: ThreadComment = { ...MINE, id: 'm2' };
    const comments = [older, RAVI, newest];
    expect(keyboardOn(render(<Thread {...PROPS} comments={comments} menu />))).toEqual([]);
    cleanUp();
    expect(keyboardOn(render(<Thread {...PROPS} comments={comments} menu focused />))).toEqual([
      'm2',
    ]);
    cleanUp();
    // In a popover, the ring says which: it's focus on a comment.
    expect(
      keyboardOn(render(<Thread {...PROPS} comments={comments} menu focused variant="popover" />)),
    ).toEqual([]);
  });

  it('says a delete is at work in place of its comment’s `⋯`', () => {
    const host = render(
      <Thread {...PROPS} comments={[MIRA, { ...MINE, id: 'm1' }]} menu deleting="m1" />,
    );
    const mine = host.querySelector('[data-comment="m1"]')!;
    expect(mine.querySelector('button')).toBeNull();
    expect(mine.textContent).toContain('Deleting…');
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
    // The name takes 120 px. Each step given up gives it more room: none, the "Author" tag, then
    // the words of a delete at work, which is enough.
    const room = [40, 90, 130, 160];
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
      const host = render(
        <Thread {...PROPS} comments={[{ ...MINE, byAuthor: true }]} menu deleting="c3" />,
      );
      const head = host.querySelector('[data-fit]')?.parentElement?.parentElement;
      expect(head?.getAttribute('data-gave-up')).toBe('tag labels');
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
          menu
          keys={{ resolve: ['x'], reply: ['r'] }}
        />
        <Thread {...PROPS} resolved open={false} excerpt="Import order" />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});

/** A thread in a popover, pinned where `focused` says. */
function popover(focused: boolean) {
  return (
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
}

/** The comment the ring is on, by its id. */
function ringed(): string | null | undefined {
  return document.activeElement?.getAttribute('data-comment');
}

describe('Thread in a popover', () => {
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

  it('moves the ring from comment to comment, from the popover itself to its first', () => {
    const host = render(
      <ThreadPopover
        label="Unresolved thread · lines 10–35"
        threads={[{ id: 'one', card: popover(true) }]}
      />,
    );
    const shell = host.querySelector<HTMLElement>('[data-thread-pop]')!;
    // A click on its mark puts focus on the popover, with no comment ringed.
    shell.focus();
    expect(ringComment(1)).toBe(true);
    expect(ringed()).toBe('c1');
    expect(ringComment(1)).toBe(true);
    expect(ringed()).toBe('c2');
    // Not past the last.
    expect(ringComment(1)).toBe(false);
    expect(ringComment(-1)).toBe(true);
    expect(ringed()).toBe('c1');
  });
});

/** The comments in `host` the keyboard is on, by their ids. */
function keyboardOn(host: HTMLElement): (string | null)[] {
  return [...host.querySelectorAll('[data-comment][data-focused]')].map((each) =>
    each.getAttribute('data-comment'),
  );
}
