// @vitest-environment jsdom
// The comment box's frame in each state the design draws: writing, previewing, uploading under the
// warning, files dragged over it, a restored draft, and a repository that takes no uploads. The
// editor is a slot, and the account is shown, never chosen.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, render, rerender } from '../test/dom.ts';
import { findScope } from './commands/scopes.ts';
import { CommentBox, type CommentBoxFoot, type CommentBoxProps } from './CommentBox.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const EDITOR = <div data-testid="editor">This throws with `retryAfter: 0`.</div>;

const ACTIONS: NonNullable<CommentBoxFoot['actions']> = [
  { label: 'Comment now', keys: ['⌥⏎'] },
  { label: 'Add to review', keys: ['⌘⏎'], primary: true },
];

const WRITING: CommentBoxProps = {
  children: EDITOR,
  label: 'New comment',
  focused: true,
  head: {
    previewKeys: ['⌘⇧V'],
    where: 'On lines 39–41, new side',
    account: { login: 'tess-okafor' },
  },
  foot: {
    mode: { name: 'INSERT', kind: 'insert' },
    attach: { keys: ['⌘⇧A'] },
    actions: ACTIONS,
  },
};

function labelled(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((each) => each.textContent.startsWith(text));
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
    // The head: Write and Preview with the key, where it goes, and who it's from.
    const head = box?.firstElementChild;
    expect(head?.textContent).toContain('WritePreview⌘⇧V');
    expect(head?.textContent).toContain('On lines 39–41, new side');
    expect(head?.textContent).toContain('as tess-okafor');
    // The foot: the mode, Attach with its key, the hint, then the buttons.
    const foot = box?.lastElementChild;
    expect(foot?.textContent).toBe(
      'INSERTAttach⌘⇧Aor drop or paste filesComment now⌥⏎Add to review⌘⏎',
    );
    const buttons = [...(foot?.querySelectorAll('button') ?? [])].map((each) => each.textContent);
    expect(buttons.at(-1)).toBe('Add to review⌘⏎');
    // Nothing is off, so there's nothing to explain.
    expect(box?.querySelector('[role="status"]')).toBeNull();
  });

  it('shows the account and never offers to choose another', () => {
    const host = render(<CommentBox {...WRITING} />);
    const account = host.querySelector('[title="Commenting as tess-okafor"]');
    expect(account?.tagName).toBe('SPAN');
    expect(host.querySelector('[role="menu"], [aria-haspopup]')).toBeNull();
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
    expect(host.querySelector('[role="region"]')?.textContent).toBe('Nothing to preview.');
  });

  it('shows the upload warning first, each file with its size and progress, and holds the buttons', () => {
    const onCancel = vi.fn<() => void>();
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
        ]}
        foot={{
          mode: { name: 'INSERT', kind: 'insert' },
          actions: ACTIONS.map((each) => ({
            ...each,
            disabled: true,
            why: 'Sending waits while a file uploads.',
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
    expect(html.indexOf('retry-storm.gif')).toBeLessThan(html.indexOf('INSERT'));
    const [moving, done, unknown] = [...box.querySelectorAll('[aria-label="Uploads"] > li')];
    // (The meter holds a hidden character of Base UI's own between the size and the button.)
    expect(moving?.textContent).toMatch(/^retry-storm\.gif3\.4 MB.*Cancel$/);
    expect(moving?.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('62');
    expect(done?.textContent).toBe('grafana-429s.png212 KBUploaded');
    expect(done?.querySelector('button')).toBeNull();
    // A progress it can't know shows no bar and no number.
    expect(unknown?.textContent).toBe('trace.mp49 MBUploadingCancel');
    expect(unknown?.querySelector('[role="meter"]')).toBeNull();
    click(moving!.querySelector('button')!);
    expect(onCancel).toHaveBeenCalledOnce();
    // Sending waits while an upload runs.
    for (const name of ['Comment now', 'Add to review']) {
      const button = labelled(host, name);
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      click(button!);
    }
    expect(onClick).not.toHaveBeenCalled();
    // Why they're off is in the box, said once, and the buttons point to it.
    const notes = [...box.querySelectorAll('[role="status"]')].map((each) => each.textContent);
    expect(notes.filter((each) => each === 'Sending waits while a file uploads.')).toHaveLength(1);
    const why = [...box.querySelectorAll('[role="status"]')].find(
      (each) => each.textContent === 'Sending waits while a file uploads.',
    );
    expect(labelled(host, 'Add to review')?.getAttribute('aria-describedby')).toBe(why?.id);
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

  it('draws a restored draft with its Discard, the mode dimmed and what it is in the foot', () => {
    const onDiscard = vi.fn<() => void>();
    const host = render(
      <CommentBox
        label="Reply"
        notes={[
          {
            key: 'restored',
            tone: 'info',
            icon: 'clock',
            text: 'Restored your draft from yesterday, 18:40.',
            actions: [{ label: 'Discard', onClick: onDiscard }],
          },
        ]}
        foot={{
          mode: { name: 'NORMAL', kind: 'normal' },
          text: "Reply to tess-okafor's thread",
          actions: [{ label: 'Reply now', keys: ['⌥⏎'] }, ...ACTIONS.slice(1)],
        }}
      >
        {EDITOR}
      </CommentBox>,
    );
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Restored your draft from yesterday, 18:40.Discard',
    );
    click(labelled(host, 'Discard')!);
    expect(onDiscard).toHaveBeenCalledOnce();
    const foot = host.querySelector('[role="group"]')?.lastElementChild;
    expect(foot?.textContent).toBe("NORMALReply to tess-okafor's threadReply now⌥⏎Add to review⌘⏎");
    // Not focused, where the box with the editor focused is.
    expect(host.querySelector('[role="group"]')?.hasAttribute('data-focused')).toBe(false);
    expect(
      render(<CommentBox {...WRITING} />)
        .querySelector('[role="group"]')
        ?.hasAttribute('data-focused'),
    ).toBe(true);
  });

  it('turns Attach off where uploads are refused, with its note, and leaves out the hint', () => {
    const onAttach = vi.fn<() => void>();
    const host = render(
      <CommentBox
        {...WRITING}
        notes={[
          {
            key: 'refused',
            tone: 'warning',
            icon: 'blocked',
            text: "GitHub won't take uploads from tess-o in this repo. Link the file instead.",
          },
        ]}
        foot={{
          mode: { name: 'INSERT', kind: 'insert' },
          attach: { disabled: true, onClick: onAttach },
          actions: ACTIONS,
        }}
      />,
    );
    const attach = labelled(host, 'Attach');
    expect(attach?.getAttribute('aria-disabled')).toBe('true');
    click(attach!);
    expect(onAttach).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('or drop or paste files');
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "GitHub won't take uploads",
    );
  });

  it('attaches from its button, and says the other ways in', () => {
    const onAttach = vi.fn<() => void>();
    const host = render(
      <CommentBox
        {...WRITING}
        foot={{
          attach: { keys: ['⌘⇧A'], onClick: onAttach, hint: 'Drop, paste or pick images' },
        }}
      />,
    );
    click(labelled(host, 'Attach')!);
    expect(onAttach).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Drop, paste or pick images');
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
          ]}
          dropping={2}
        />
        <CommentBox {...WRITING} previewing preview={<p>x</p>} />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});
