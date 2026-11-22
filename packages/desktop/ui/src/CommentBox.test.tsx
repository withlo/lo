// @vitest-environment jsdom
// The comment box's frame in each state the design draws: writing, previewing, uploading under the
// warning, files dragged over it, a restored draft, and a repository that takes no uploads. The
// editor is a slot; the account is shown, never chosen; and Vim's mode shows only with Vim keys on.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, render, rerender } from '../test/dom.ts';
import { setVim } from './vim.ts';
import { findScope } from './commands/scopes.ts';
import { CommentBox, type CommentBoxFoot, type CommentBoxProps } from './CommentBox.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
  setVim(false);
});

const EDITOR = <div data-testid="editor">This throws with `retryAfter: 0`.</div>;

const ACTIONS: NonNullable<CommentBoxFoot['actions']> = [
  { label: 'Send now', keys: ['⌥⏎'] },
  { label: 'Add to review', keys: ['⌘⏎'], primary: true },
];

const WRITING: CommentBoxProps = {
  children: EDITOR,
  label: 'New comment',
  focused: true,
  head: {
    previewKeys: ['⌘⇧V'],
    where: 'Lines 39–41',
    account: { login: 'tess-okafor' },
  },
  foot: {
    mode: { name: 'INSERT', kind: 'insert' },
    attach: { keys: ['⌘⇧A'] },
    discard: {},
    actions: ACTIONS,
  },
};

/** What the mode chip under `host` says, if there's one. */
function chip(host: HTMLElement): string | undefined {
  return host.querySelector('.mode-chip')?.textContent;
}

/** The button that says `text`, or is named it. */
function labelled(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(
    (each) => each.textContent.startsWith(text) || each.getAttribute('aria-label') === text,
  );
}

/** A box with a real editor in it, as it is when the preview is switched on and off. */
function withPreview(previewing: boolean) {
  return (
    <CommentBox {...WRITING} previewing={previewing} preview={<p>Previewed.</p>}>
      <textarea aria-label="Comment" />
    </CommentBox>
  );
}

/** The same box with something else on the page to hold focus. */
function besideButton(previewing: boolean) {
  return (
    <>
      <button type="button">Elsewhere</button>
      <CommentBox {...WRITING} previewing={previewing}>
        <textarea aria-label="Comment" />
      </CommentBox>
    </>
  );
}

describe('CommentBox', () => {
  it('frames the editor with a head, a foot and the two buttons, the main one last', () => {
    const host = render(<CommentBox {...WRITING} />);
    const box = host.querySelector('[role="group"]');
    expect(box?.getAttribute('aria-label')).toBe('New comment');
    expect(box?.querySelector('[data-testid="editor"]')?.textContent).toBe(
      'This throws with `retryAfter: 0`.',
    );
    // The head: what it's on first, then who it's from (after their initials, which stand in for
    // a picture), and Write and Preview with the key.
    const head = box?.firstElementChild;
    expect(head?.textContent).toBe('Lines 39–41TOas tess-okaforWritePreview⌘⇧V');
    // The foot: the icon that attaches, "Discard draft", then the buttons with their keys. No mode
    // with Vim keys off, and no line of keys.
    const foot = box?.lastElementChild;
    expect(foot?.textContent).toBe('Discard draftSend now⌥⏎Add to review⌘⏎');
    const buttons = [...(foot?.querySelectorAll('button') ?? [])];
    expect(buttons.map((each) => each.getAttribute('aria-label') ?? each.textContent)).toEqual([
      'Attach files…',
      'Discard draft',
      'Send now⌥⏎',
      'Add to review⌘⏎',
    ]);
    // Nothing is off, so there's nothing to explain.
    expect(box?.querySelector('[data-note]')).toBeNull();
  });

  it('shows Vim’s mode only with Vim keys on, in the box that has focus', () => {
    expect(chip(render(<CommentBox {...WRITING} />))).toBeUndefined();
    setVim(true);
    expect(chip(render(<CommentBox {...WRITING} />))).toBe('INSERT');
    expect(chip(render(<CommentBox {...WRITING} focused={false} />))).toBeUndefined();
  });

  it('shows the account and never offers to choose another', () => {
    const host = render(<CommentBox {...WRITING} />);
    expect(host.querySelector('[role="menu"], [aria-haspopup]')).toBeNull();
    // A box given no account, as where one is signed in, says nothing of who it's from.
    const alone = render(<CommentBox {...WRITING} head={{ where: 'Reply' }} />);
    expect(alone.querySelector('[role="group"]')?.firstElementChild?.textContent).toBe(
      'ReplyWritePreview',
    );
  });

  it('closes from its head and discards from its foot, each with a control', () => {
    const onClose = vi.fn<() => void>();
    const onDiscard = vi.fn<() => void>();
    const host = render(
      <CommentBox
        {...WRITING}
        head={{
          ...WRITING.head,
          why: 'Those lines aren’t in the diff.',
          close: { keys: ['Esc'], onClick: onClose },
        }}
        foot={{ ...WRITING.foot, discard: { onClick: onDiscard } }}
      />,
    );
    // Why the comment is on what the head says, under it.
    expect(host.querySelector('[role="group"]')?.firstElementChild?.textContent).toContain(
      'Those lines aren’t in the diff.',
    );
    click(labelled(host, 'Close comment box')!);
    expect(onClose).toHaveBeenCalledOnce();
    click(labelled(host, 'Discard draft')!);
    expect(onDiscard).toHaveBeenCalledOnce();
    // With nothing to discard it's dimmed, says why, and does nothing.
    const off = render(
      <CommentBox
        {...WRITING}
        foot={{
          ...WRITING.foot,
          discard: { disabled: true, why: 'Nothing to discard', onClick: onDiscard },
        }}
      />,
    );
    const dimmed = labelled(off, 'Discard draft');
    expect(dimmed?.getAttribute('aria-disabled')).toBe('true');
    expect(
      off.ownerDocument.getElementById(dimmed?.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Nothing to discard');
    click(labelled(off, 'Discard draft')!);
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it('gives up its key chips, then its labels, then its hint as it narrows', () => {
    const host = render(
      <CommentBox {...WRITING} foot={{ ...WRITING.foot, text: 'Summary · Markdown' }} />,
    );
    const foot = host.querySelector('[role="group"]')!.lastElementChild!;
    // The foot's own box is what its parts measure.
    expect(foot.className).toContain('@container');
    const classes = (selector: string) =>
      [...foot.querySelectorAll(selector)].map((each) => each.classList.contains('box-chip'));
    expect(classes('kbd')).toEqual([true, true]);
    const said = (text: string) =>
      [...foot.querySelectorAll('span')].find((each) => each.textContent === text);
    expect(said('Summary · Markdown')?.classList.contains('box-hint')).toBe(true);
    expect(said('Discard draft')?.classList.contains('box-label')).toBe(true);
    // The buttons keep their words at any width.
    expect(labelled(host, 'Add to review')?.className).toContain('whitespace-nowrap');
  });

  it('switches between Write and Preview, and keeps the editor in the box while it previews', () => {
    const onPreviewing = vi.fn<(previewing: boolean) => void>();
    const writing = render(<CommentBox {...WRITING} />);
    expect(writing.querySelector('[role="region"]')).toBeNull();

    const host = render(
      <CommentBox
        {...WRITING}
        head={{ ...WRITING.head, onPreviewing }}
        previewing
        preview={
          <p>
            This throws with <code>retryAfter: 0</code>.
          </p>
        }
      />,
    );
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.map((each) => [each.textContent, each.getAttribute('aria-selected')])).toEqual([
      ['Write', 'false'],
      ['Preview', 'true'],
    ]);
    expect(host.querySelector('[role="region"]')?.textContent).toBe(
      'This throws with retryAfter: 0.',
    );
    // Hidden, not removed: whatever it holds stays.
    const editor = host.querySelector('[data-testid="editor"]');
    expect(editor).not.toBeNull();
    expect(editor?.parentElement?.hasAttribute('hidden')).toBe(true);
    click(tabs[0]!);
    expect(onPreviewing).toHaveBeenCalledWith(false);
  });

  it('takes focus to the preview and gives it back to the editor, in the box’s scope throughout', () => {
    const host = render(withPreview(false));
    const editor = host.querySelector('textarea')!;
    focus(editor);
    expect(findScope(document.activeElement).name).toBe('box');

    // The editor is hidden: focus goes to the preview rather than to the page.
    rerender(host, withPreview(true));
    const pane = host.querySelector('[role="region"]');
    expect(pane?.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(pane);
    expect(findScope(document.activeElement).name).toBe('box');

    // The preview is gone: focus goes back to the same editor.
    rerender(host, withPreview(false));
    expect(document.activeElement).toBe(host.querySelector('textarea'));
    expect(document.activeElement).toBe(editor);
    expect(findScope(document.activeElement).name).toBe('box');
  });

  it('leaves focus where it is when the preview is switched from outside the box', () => {
    const host = render(besideButton(false));
    const elsewhere = host.querySelector('button')!;
    focus(elsewhere);
    rerender(host, besideButton(true));
    expect(document.activeElement).toBe(elsewhere);
    rerender(host, besideButton(false));
    expect(document.activeElement).toBe(elsewhere);
  });

  it('hands the box’s element to whoever answers for its keys', () => {
    let element: HTMLDivElement | null = null;
    const host = render(
      <CommentBox
        {...WRITING}
        frameRef={(each) => {
          element = each;
        }}
      />,
    );
    expect(element).toBe(host.querySelector('[role="group"]'));
    expect(host.querySelector('[role="group"]')?.getAttribute('data-lo-scope')).toBe('box');
  });

  it('says there is nothing to preview when there is nothing', () => {
    const host = render(<CommentBox {...WRITING} previewing />);
    expect(host.querySelector('[role="region"]')?.textContent).toBe('Nothing to preview');
  });

  it('shows the upload warning first, each file with its size and progress, and holds the buttons', () => {
    const onCancel = vi.fn<() => void>();
    const onInsert = vi.fn<() => void>();
    const onClick = vi.fn<() => void>();
    const host = render(
      <CommentBox
        {...WRITING}
        notes={[
          {
            key: 'warning',
            tone: 'warning',
            text: 'Uploads go to GitHub and stay reachable by link, even if you delete the comment.',
          },
        ]}
        uploads={[
          { key: 'a', name: 'retry-storm.gif', size: '3.4 MB', progress: 0.62, onCancel },
          { key: 'b', name: 'grafana-429s.png', size: '212 KB', uploaded: true },
          { key: 'c', name: 'trace.mp4', size: '9 MB' },
          { key: 'd', name: 'flame.png', size: '2 KB', uploaded: true, onInsert },
        ]}
        foot={{
          mode: { name: 'INSERT', kind: 'insert' },
          actions: ACTIONS.map((each) => ({
            ...each,
            disabled: true,
            why: 'A file is still uploading',
            onClick,
          })),
        }}
      />,
    );
    const box = host.querySelector('[role="group"]')!;
    const html = box.innerHTML;
    // The warning above the editor, the editor above the uploads, the uploads above the foot.
    expect(html.indexOf('Uploads go to GitHub')).toBeLessThan(html.indexOf('data-testid="editor"'));
    expect(html.indexOf('data-testid="editor"')).toBeLessThan(html.indexOf('retry-storm.gif'));
    expect(html.indexOf('retry-storm.gif')).toBeLessThan(html.indexOf('Add to review'));
    const [moving, done, unknown, unplaced] = [
      ...box.querySelectorAll('[aria-label="Attached files"] > li'),
    ];
    // (The meter holds a hidden character of Base UI's own between the size and the percent.)
    expect(moving?.textContent).toMatch(/^retry-storm\.gif3\.4 MB.*Uploading · 62%Cancel$/);
    expect(moving?.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('62');
    // One that's in says nothing more: its row has no spinner.
    expect(done?.textContent).toBe('grafana-429s.png212 KB');
    expect(done?.querySelector('button')).toBeNull();
    // A progress it can't know shows no bar and no number.
    expect(unknown?.textContent).toBe('trace.mp49 MBUploading…Cancel');
    expect(unknown?.querySelector('[role="meter"]')).toBeNull();
    // One uploaded whose placeholder went says it isn't in the comment, and offers to put it in.
    expect(unplaced?.textContent).toBe('flame.png2 KBNot in commentInsert');
    const insert = unplaced!.querySelector('button')!;
    click(insert);
    expect(onInsert).toHaveBeenCalledOnce();
    click(moving!.querySelector('button')!);
    expect(onCancel).toHaveBeenCalledOnce();
    // Sending waits while an upload runs.
    for (const name of ['Send now', 'Add to review']) {
      const button = labelled(host, name);
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      click(button!);
    }
    expect(onClick).not.toHaveBeenCalled();
    // Why they're off is no line in the box: it's what describes the buttons, said once, and their
    // tooltip.
    const notes = [...box.querySelectorAll('[data-note]')].map((each) => each.textContent);
    expect(notes).toEqual([
      'Uploads go to GitHub and stay reachable by link, even if you delete the comment.',
    ]);
    const why = [...box.querySelectorAll('.sr-only')].filter(
      (each) => each.textContent === 'A file is still uploading',
    );
    expect(why).toHaveLength(1);
    expect(labelled(host, 'Add to review')?.getAttribute('aria-describedby')).toBe(why[0]?.id);
  });

  it('says a file whose bytes have all gone is still uploading, with no number', () => {
    const host = render(
      <CommentBox
        {...WRITING}
        uploads={[{ key: 'a', name: 'retry-storm.gif', size: '3.4 MB', progress: 1 }]}
      />,
    );
    const row = host.querySelector('[aria-label="Attached files"] > li');
    // GitHub hasn't answered: it isn't done at 100%, and no meter says it is.
    expect(row?.textContent).toMatch(/^retry-storm\.gif3\.4 MBUploading…/);
    expect(row?.querySelector('[role="meter"]')).toBeNull();
  });

  it('says what failed on a line of its own, why under it, and what to do in one button', () => {
    const onClick = vi.fn<() => void>();
    const host = render(
      <CommentBox
        {...WRITING}
        notes={[
          {
            key: 'sending',
            tone: 'danger',
            title: 'Couldn’t send the comment',
            text: 'GitHub didn’t respond.',
            actions: [{ label: 'Check again', onClick }],
          },
        ]}
      />,
    );
    const note = host.querySelector('[data-note="danger"]');
    expect(note?.querySelector('b')?.textContent).toBe('Couldn’t send the comment');
    // The reason isn't on the title's line.
    expect(note?.querySelector('b')?.nextElementSibling?.textContent).toBe(
      'GitHub didn’t respond.',
    );
    // It's drawn with its words on it: whoever shows it says it to a screen reader.
    expect(note?.getAttribute('role')).toBeNull();
    click(note!.querySelector('button')!);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('says how many files are over it while they are dragged, and not over a preview', () => {
    const host = render(<CommentBox {...WRITING} head={undefined} foot={undefined} dropping={2} />);
    expect(host.textContent).toContain('Drop to attach 2 files');
    expect(render(<CommentBox {...WRITING} dropping={1} />).textContent).toContain(
      'Drop to attach 1 file',
    );
    expect(render(<CommentBox {...WRITING} dropping={2} previewing />).textContent).not.toContain(
      'Drop to attach',
    );
  });

  it('says a draft was restored in one quiet line over the buttons', () => {
    const host = render(
      <CommentBox
        label="Reply"
        head={{ where: 'Reply' }}
        foot={{
          mode: { name: 'NORMAL', kind: 'normal' },
          lines: [{ key: 'restored', text: 'Draft from 12 min ago' }],
          discard: {},
          actions: ACTIONS,
        }}
      >
        {EDITOR}
      </CommentBox>,
    );
    expect(host.querySelector('[data-note]')).toBeNull();
    const foot = host.querySelector('[role="group"]')?.lastElementChild;
    expect(foot?.textContent).toBe('Draft from 12 min agoDiscard draftSend now⌥⏎Add to review⌘⏎');
    // Not focused, where the box with the editor focused is.
    expect(host.querySelector('[role="group"]')?.hasAttribute('data-focused')).toBe(false);
    expect(
      render(<CommentBox {...WRITING} />)
        .querySelector('[role="group"]')
        ?.hasAttribute('data-focused'),
    ).toBe(true);
  });

  it('says a button is working while what it was pressed for is on its way', () => {
    const host = render(
      <CommentBox
        {...WRITING}
        foot={{
          actions: [
            { label: 'Send now', disabled: true },
            {
              label: 'Add to review',
              primary: true,
              disabled: true,
              busy: true,
              working: 'Sending…',
            },
          ],
        }}
      />,
    );
    const sending = labelled(host, 'Add to review');
    expect(sending?.getAttribute('aria-busy')).toBe('true');
    expect(sending?.textContent).toContain('Sending…');
  });

  it('dims "Attach files…" where uploads are refused, and attaches from it where they aren’t', () => {
    const onAttach = vi.fn<() => void>();
    const host = render(
      <CommentBox
        {...WRITING}
        foot={{
          attach: { disabled: true, why: 'Sign in to attach files', onClick: onAttach },
          actions: ACTIONS,
        }}
      />,
    );
    const attach = labelled(host, 'Attach files…');
    expect(attach?.getAttribute('aria-disabled')).toBe('true');
    click(attach!);
    expect(onAttach).not.toHaveBeenCalled();
    const on = render(
      <CommentBox {...WRITING} foot={{ attach: { keys: ['⌘⇧A'], onClick: onAttach } }} />,
    );
    click(labelled(on, 'Attach files…')!);
    expect(onAttach).toHaveBeenCalledOnce();
    // The ways in besides aren't spelled out in the foot.
    expect(on.textContent).not.toContain('drop or paste');
  });

  it('colors the mode chip by its mode: Powder soft for Normal, green for Insert, Powder for Visual', async () => {
    const css = await buildCss(['mode-chip', 'mode-chip-normal', 'mode-chip-insert']);
    const rule = (name: string) =>
      new RegExp(`\\.${name} \\{([^{}]*)\\}`).exec(css)?.[1]?.replace(/\s+/g, ' ');
    expect(rule('mode-chip-normal')).toContain('background: var(--lo-accent-soft)');
    expect(rule('mode-chip-normal')).toContain('color: var(--lo-fg-accent)');
    expect(rule('mode-chip-insert')).toContain('background: var(--lo-success-bg)');
    expect(rule('mode-chip-insert')).toContain('color: var(--lo-success)');
    // The chip keeps its shape and Powder for Visual; a mode's colors come after, and so win.
    expect(rule('mode-chip')).toContain('border-radius: var(--lo-r-xs)');
    expect(rule('mode-chip')).toContain('background: var(--lo-accent)');
    for (const modifier of ['mode-chip-normal', 'mode-chip-insert']) {
      expect(css.indexOf(`.${modifier} {`)).toBeGreaterThan(css.indexOf('.mode-chip {'));
    }
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <>
        <CommentBox
          {...WRITING}
          notes={[
            { key: 'a', tone: 'info', icon: 'clock', text: 'one' },
            {
              key: 'b',
              tone: 'warning',
              text: 'two',
              actions: [{ label: 'Go', onClick: vi.fn<() => void>() }],
            },
          ]}
          uploads={[
            { key: 'a', name: 'a.gif', size: '1 MB', progress: 0.5 },
            { key: 'b', name: 'b.png', size: '1 KB', uploaded: true },
            {
              key: 'c',
              name: 'c.png',
              size: '1 KB',
              uploaded: true,
              onInsert: vi.fn<() => void>(),
            },
          ]}
          dropping={2}
          head={{
            ...WRITING.head,
            why: 'three',
            close: { onClick: vi.fn<() => void>() },
          }}
          foot={{
            ...WRITING.foot,
            text: 'four',
            lines: [
              { key: 'l', text: 'five', action: { label: 'Go', onClick: vi.fn<() => void>() } },
            ],
          }}
        />
        <CommentBox {...WRITING} previewing preview={<p>x</p>} />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});
