// @vitest-environment jsdom
// A review thread: open with its comments, collapsed to one line, pending, outdated, and the
// actions that show only where they apply: Edit and Delete on your own comments.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cleanUp, click, render } from '../test/dom.ts';
import { missingRules } from '../test/classes.ts';
import { Thread, type ThreadComment, type ThreadProps } from './Thread.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const MIRA: ThreadComment = {
  id: 'c1',
  author: 'mira-chen',
  when: '2 days ago',
  body: <p>Import order: the linter wants type imports last.</p>,
};
const RAVI: ThreadComment = {
  id: 'c2',
  author: 'ravi-k',
  when: '1 day ago',
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

/** The buttons whose label starts with `label`. */
function buttons(host: HTMLElement, label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')].filter((each) => each.textContent.startsWith(label));
}

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
    // The avatar's initials, then who and the opening, then the replies.
    expect(line?.textContent).toBe(
      'ResolvedMCmira-chen Import order: the linter wants type imports last.1 reply',
    );
    expect(line?.getAttribute('aria-expanded')).toBe('false');
    // Only the line: none of the comments are drawn.
    expect(host.querySelectorAll('button')).toHaveLength(1);
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
    expect(unresolve?.textContent).toBe('Unresolvex');
    click(unresolve!);
    expect(onResolve).toHaveBeenCalledOnce();
    expect(buttons(host, 'Resolve')).toHaveLength(0);
  });

  it('draws a thread in your pending review by its Pending tag alone', () => {
    const pending: ThreadComment = { ...MINE, id: 'p1', pending: true };
    const host = render(<Thread {...PROPS} comments={[pending]} canResolve />);
    const thread = host.querySelector('[role="group"]');
    expect(thread?.getAttribute('aria-label')).toBe('Pending thread by tess-okafor');
    expect(thread?.textContent).toContain('Pending');
    expect(thread?.textContent).toContain('Your review, not sent');
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
    expect(head?.textContent).toContain('Outdated');
    expect(head?.textContent).toContain('On a newer push');
  });

  it('offers Edit and Delete on your own comments only, with their keys on your newest', () => {
    const older: ThreadComment = { ...MINE, id: 'm1', when: '3 days ago' };
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
    expect(deletes.map((each) => each.textContent)).toEqual(['Delete', 'Deletedd']);
    click(edits[0]!);
    click(deletes[1]!);
    expect(onEdit).toHaveBeenCalledWith('m1');
    expect(onDelete).toHaveBeenCalledWith('m2');
  });

  it('offers a reply where it can be made, and shows an open reply box in its place', () => {
    const onReply = vi.fn<() => void>();
    const host = render(<Thread {...PROPS} canReply keys={{ reply: ['r'] }} onReply={onReply} />);
    const [reply] = buttons(host, 'Reply…');
    expect(reply?.textContent).toBe('Reply…r');
    click(reply!);
    expect(onReply).toHaveBeenCalledOnce();

    const open = render(
      <Thread {...PROPS} canReply reply={<div data-testid="box">the reply box</div>} />,
    );
    expect(open.querySelector('[data-testid="box"]')?.textContent).toBe('the reply box');
    expect(buttons(open, 'Reply…')).toHaveLength(0);
  });

  it('collapses from its head, with the key in the tooltip, and rings the thread the keyboard is on', () => {
    const onToggle = vi.fn<() => void>();
    const host = render(
      <Thread {...PROPS} focused keys={{ toggle: ['z', 'a'] }} onToggle={onToggle} />,
    );
    const collapse = host.querySelector('button[aria-label="Collapse the thread"]');
    expect(collapse?.getAttribute('title')).toBe('Collapse the thread (z a)');
    click(collapse!);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="group"]')?.className).toContain('shadow-ring');
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
