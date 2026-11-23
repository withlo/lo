// @vitest-environment jsdom
// The merge panel's frame, in each state it takes: why it can't merge, ready to merge with
// the commit's text, ready for a queue, waiting on auto-merge, and blocks Lo can't mend.

import { act, createRef, useState, type ReactNode, type RefObject } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, press, render, rerender, tipOf } from '../test/dom.ts';
import { Branch } from './Branch.tsx';
import { Button } from './Button.tsx';
import { Callout } from './Callout.tsx';
import { Checklist, checkRowId, type CheckItem } from './Checklist.tsx';
import { Key } from './Key.tsx';
import {
  CommitText,
  MergeFoot,
  MergeMethods,
  MergePanel,
  type MergePanelProps,
} from './MergePanel.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
  document.body.replaceChildren();
});

/** The panel, once open: Base UI draws it into the page's body. */
function panel(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[role="dialog"]');
  if (found === null) throw new Error('The merge panel is not open.');
  return found;
}

/** The panel's head, body and foot, in order. */
function parts(): { head: HTMLElement; body: HTMLElement | undefined; foot: HTMLElement } {
  const [head, ...rest] = [...panel().children].filter((each) => each instanceof HTMLElement);
  const foot = rest.at(-1);
  const body = rest.length > 1 ? rest[0] : undefined;
  if (head === undefined || foot === undefined) throw new Error('The panel has no head or foot.');
  return { head, body, foot };
}

function frame(props: Partial<MergePanelProps> & Pick<MergePanelProps, 'kind' | 'verdict'>) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  return render(
    <MergePanel
      open
      onOpenChange={() => undefined}
      anchor={anchor}
      scope="merge"
      closeKeys={['Esc']}
      {...props}
    />,
  );
}

const unmet: CheckItem[] = [
  {
    key: 'review',
    kind: 'fail',
    glyph: 'review',
    title: 'Review required',
    detail: '1 more approval, and one from a code owner of src/graphql/.',
  },
  {
    key: 'threads',
    kind: 'fail',
    glyph: 'conversation',
    title: '5 unresolved conversations',
    end: (
      <Button variant="ghost" size="sm">
        Next <Key keys={[']', 't']} quiet decorative />
      </Button>
    ),
  },
];

function Squash({ onMerge = vi.fn<() => void>() }: { onMerge?: () => void }) {
  const [method, setMethod] = useState<'squash' | 'rebase'>('squash');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [auto, setAuto] = useState(false);
  const turn = () => setAuto((on) => !on);
  return (
    <MergePanel
      open
      onOpenChange={() => undefined}
      anchor={document.body.querySelector('button')}
      scope="merge"
      kind="ready"
      verdict="Ready to merge"
      sub={
        <>
          into <Branch name="main" base /> · approved by jun-park · 12 checks passed
        </>
      }
      foot={
        <MergeFoot
          auto={{
            label: auto ? 'Turn off auto-merge' : 'Turn on auto-merge…',
            keys: ['a'],
            onClick: turn,
          }}
          primary={{
            label: method === 'squash' ? 'Squash and merge' : 'Rebase and merge',
            keys: ['⏎'],
            onClick: onMerge,
          }}
        />
      }
    >
      <div className="flex flex-col gap-12 pb-8">
        <MergeMethods
          methods={[
            { value: 'squash', label: 'Squash' },
            { value: 'rebase', label: 'Rebase' },
          ]}
          value={method}
          onChange={setMethod}
          note="Merge commits are off in this repo"
          keys={['Tab']}
        />
        <CommitText
          title={{
            value: title,
            onChange: setTitle,
            placeholder: 'Fix N+1 queries in the issue timeline (#4797)',
          }}
          message={{
            value: message,
            onChange: setMessage,
            placeholder: '* Batch label lookups',
          }}
        />
      </div>
    </MergePanel>
  );
}

function open(onMerge?: () => void) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  return render(<Squash {...(onMerge === undefined ? {} : { onMerge })} />);
}

/** The panel with `focused` as the row the keyboard is on, and the list for it to focus. */
const viewFocusing = (focused: string | undefined, list?: RefObject<HTMLUListElement | null>) => (
  <MergePanel
    open
    onOpenChange={() => undefined}
    anchor={document.body.querySelector('button')}
    scope="merge"
    kind="waiting"
    verdict="Can't merge yet"
    focusRef={list}
    foot={<MergeFoot primary={{ label: 'Merge', disabled: true }} />}
  >
    <Checklist
      id="reasons"
      label="Why it can't merge"
      rows={unmet}
      focused={focused}
      listRef={list}
    />
  </MergePanel>
);

/** The key cap on the button in the open panel whose label starts with `label`. */
const keyOf = (label: string) =>
  [...panel().querySelectorAll('button')]
    .find((each) => each.textContent?.startsWith(label))
    ?.querySelector('kbd');

describe('MergePanel', () => {
  it('opens as a dialog named Merge panel, in the scope its keys apply in, with a head, body and foot', () => {
    frame({
      kind: 'waiting',
      verdict: "Can't merge yet",
      sub: (
        <>
          into <Branch name="ravi/plan-limits" base /> · 6 things in the way
        </>
      ),
      children: <Checklist id="reasons" label="Why it can't merge" rows={unmet} />,
      foot: (
        <MergeFoot
          auto={{ label: 'Turn on auto-merge…', keys: ['a'], onClick: () => undefined }}
          method="Squash"
          primary={{ label: 'Merge #264…', keys: ['⏎'], reason: '2 unresolved threads' }}
        />
      ),
    });
    const dialog = panel();
    expect(dialog.getAttribute('aria-label')).toBe('Merge panel');
    expect(dialog.getAttribute('data-lo-scope')).toBe('merge');
    expect(dialog.getAttribute('data-kind')).toBe('waiting');
    expect(dialog.children).toHaveLength(3);
    const { head, body, foot } = parts();
    expect(head.textContent).toContain("Can't merge yet");
    expect(head.textContent).toContain('into ravi/plan-limits · 6 things in the way');
    // The dot is the verdict's color, and there's a way to close it by key.
    expect(head.querySelector('.bg-warning')).not.toBeNull();
    // The key is in its tooltip, not its name.
    expect(head.querySelector('button')?.getAttribute('aria-label')).toBe('Close merge panel');
    expect(body?.querySelectorAll('li[data-key]')).toHaveLength(2);
    expect(foot.textContent).toContain('Turn on auto-merge…');
    expect(foot.textContent).toContain('Squash');
    // A main button that can't be pressed says why, in its description.
    const primary = [...foot.querySelectorAll('button')].at(-1);
    expect(primary?.getAttribute('aria-disabled')).toBe('true');
    expect(primary?.getAttribute('aria-description')).toBe('2 unresolved threads');
  });

  it('takes focus as it opens, so its keys apply, and gives it back when it closes', async () => {
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const view = (shown: boolean) => (
      <MergePanel
        open={shown}
        onOpenChange={() => undefined}
        anchor={anchor}
        scope="merge"
        kind="ready"
        verdict="Ready to merge"
      />
    );
    const host = render(view(true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(panel());
    rerender(host, view(false));
    await act(async () => {
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(document.activeElement).toBe(before);
  });

  it('names the row the keyboard is on as its list’s active descendant, not its own, and rings it', () => {
    document.body.append(document.createElement('button'));
    const host = render(viewFocusing('threads'));
    const dialog = panel();
    // A dialog can't have one: the listbox in it does, and it's the one with the ring's group.
    expect(dialog.hasAttribute('aria-activedescendant')).toBe(false);
    const list = dialog.querySelector('[role="listbox"]');
    expect(list?.getAttribute('aria-activedescendant')).toBe(checkRowId('reasons', 'threads'));
    const row = dialog.querySelector(`[id="${list?.getAttribute('aria-activedescendant')}"]`);
    expect(row?.getAttribute('role')).toBe('option');
    expect(row?.getAttribute('data-key')).toBe('threads');
    expect(row?.className).toContain('group-focus-visible/list:shadow-ring-inset');
    expect(list?.className).toContain('group/list');
    // With no row on, or one that isn't in the list, the list names none.
    rerender(host, viewFocusing(undefined));
    expect(panel().querySelector('[role="listbox"]')?.hasAttribute('aria-activedescendant')).toBe(
      false,
    );
    rerender(host, viewFocusing('not-a-reason'));
    expect(panel().querySelector('[role="listbox"]')?.hasAttribute('aria-activedescendant')).toBe(
      false,
    );
  });

  it('takes focus on the list it is given as it opens, and hears the keys pressed there', async () => {
    document.body.append(document.createElement('button'));
    const list = createRef<HTMLUListElement>();
    const keys: string[] = [];
    render(
      <div
        onKeyDown={(event) => {
          keys.push(event.key);
        }}
      >
        {viewFocusing('review', list)}
      </div>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(list.current).not.toBeNull();
    expect(document.activeElement).toBe(list.current);
    // The keys are the panel's: they reach it from the list, inside its key scope.
    expect(list.current?.closest('[data-lo-scope]')).toBe(panel());
    press(list.current!, 'j');
    expect(keys).toContain('j');
  });

  it('hands on the keys pressed in it', () => {
    const onKeyDown = vi.fn<(event: { key: string }) => void>();
    frame({
      kind: 'ready',
      verdict: 'Ready to merge',
      onKeyDown,
      foot: <MergeFoot primary={{ label: 'Squash and merge' }} />,
    });
    press(panel(), 'j');
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(onKeyDown.mock.calls[0]?.[0].key).toBe('j');
  });

  it('draws the main button’s key on the fill, and where the fill has gone, in the quiet color', () => {
    frame({
      kind: 'ready',
      verdict: 'Ready to merge',
      foot: <MergeFoot primary={{ label: 'Squash and merge', keys: ['⏎'] }} />,
    });
    expect(keyOf('Squash and merge')?.className).toContain('text-on-accent');
    cleanUp();
    frame({
      kind: 'waiting',
      verdict: "Can't merge yet",
      foot: <MergeFoot primary={{ label: 'Merge', keys: ['⏎'], disabled: true }} />,
    });
    // No fill behind it: on-accent text would be nothing on nothing.
    expect(keyOf('Merge')?.className).not.toContain('text-on-accent');
    expect(keyOf('Merge')?.className).toContain('text-fg-muted');
  });

  it('says what Lo is checking in the main button’s place, and takes no click until it’s done', () => {
    const onClick = vi.fn<() => void>();
    const busy = { label: 'Merge', keys: ['⏎'], busy: true, working: 'Checking…', onClick };
    frame({ kind: 'ready', verdict: 'Ready to merge', foot: <MergeFoot primary={busy} /> });
    const button = [...panel().querySelectorAll('button')].at(-1);
    // Its label stays, unseen, holding its width.
    const shown = button?.querySelector('span > span:not([aria-hidden])');
    expect(shown?.textContent).toBe('Checking…');
    expect(shown?.querySelector('kbd')).toBeNull();
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    click(button!);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets a key focus the commit’s fields, and hands on the keys pressed in them', () => {
    const title = createRef<HTMLInputElement>();
    const message = createRef<HTMLTextAreaElement>();
    const onTitleKey = vi.fn<(event: { key: string }) => void>();
    const onMessageKey = vi.fn<(event: { key: string }) => void>();
    const host = render(
      <CommitText
        titleRef={title}
        messageRef={message}
        title={{ value: 'A title', onChange: () => undefined, onKeyDown: onTitleKey }}
        message={{ value: 'A message', onChange: () => undefined, onKeyDown: onMessageKey }}
      />,
    );
    expect(title.current).toBe(host.querySelector('input'));
    expect(message.current).toBe(host.querySelector('textarea'));
    focus(title.current!);
    expect(document.activeElement).toBe(title.current);
    focus(message.current!);
    expect(document.activeElement).toBe(message.current);
    press(title.current!, 'Escape');
    press(message.current!, 'Escape');
    expect(onTitleKey.mock.calls.map(([event]) => event.key)).toEqual(['Escape']);
    expect(onMessageKey.mock.calls.map(([event]) => event.key)).toEqual(['Escape']);
  });

  it('draws nothing while it is closed', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    render(
      <MergePanel
        open={false}
        onOpenChange={() => undefined}
        anchor={anchor}
        scope="merge"
        kind="ready"
        verdict="Ready to merge"
      />,
    );
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('asks to close from its button', () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    frame({ kind: 'ready', verdict: 'Ready to merge', onOpenChange });
    click(panel().querySelector('button[aria-label^="Close"]')!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('asks to close on Esc', () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    frame({
      kind: 'ready',
      verdict: 'Ready to merge',
      onOpenChange,
      foot: <MergeFoot primary={{ label: 'Squash and merge' }} />,
    });
    press(panel(), 'Escape');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaves its body out when it has nothing to show', () => {
    frame({
      kind: 'merged',
      verdict: 'Merged',
      foot: <MergeFoot primary={{ label: 'Done', keys: ['⏎'] }} />,
    });
    expect(panel().children).toHaveLength(2);
  });

  it('draws the verdict without the characters that turn text around', () => {
    frame({ kind: 'ready', verdict: 'Ready \u202Eto merge' });
    expect(panel().innerHTML).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });

  describe('can merge, with a squash', () => {
    it('offers the methods the repo allows, and says which it does not', () => {
      open();
      const group = panel().querySelector('[role="radiogroup"]');
      expect(group?.getAttribute('aria-label')).toBe('Method');
      const choices = [...(group?.querySelectorAll('[role="radio"]') ?? [])];
      expect(choices.map((each) => each.textContent)).toEqual(['Squash', 'Rebase']);
      expect(choices.map((each) => each.getAttribute('aria-checked'))).toEqual(['true', 'false']);
      expect(panel().textContent).toContain('Merge commits are off in this repo');
      click(choices[1]!);
      expect(
        [...panel().querySelectorAll('[role="radio"]')].map((each) =>
          each.getAttribute('aria-checked'),
        ),
      ).toEqual(['false', 'true']);
      // The button is named for the action.
      expect(parts().foot.textContent).toContain('Rebase and merge');
    });

    it('names the squash’s title and message, starting from GitHub’s text', () => {
      open();
      const title = panel().querySelector<HTMLInputElement>('input');
      const message = panel().querySelector<HTMLTextAreaElement>('textarea');
      expect(panel().querySelector(`label[for="${title?.id}"]`)?.textContent).toBe('Commit title');
      expect(panel().querySelector(`label[for="${message?.id}"]`)?.textContent).toBe('Message');
      // Nothing typed: GitHub's own text stands in the fields, and is what's sent.
      expect(title?.value).toBe('');
      expect(title?.placeholder).toBe('Fix N+1 queries in the issue timeline (#4797)');
      expect(message?.placeholder).toBe('* Batch label lookups');
    });

    it('presses merge, and turns auto-merge on with a button, never a switch', () => {
      const onMerge = vi.fn<() => void>();
      open(onMerge);
      const { foot } = parts();
      const primary = [...foot.querySelectorAll('button')].at(-1);
      expect(primary?.textContent).toContain('Squash and merge');
      expect(primary?.className).toContain('bg-accent');
      click(primary!);
      expect(onMerge).toHaveBeenCalledOnce();
      expect(foot.querySelector('[role="switch"]')).toBeNull();
      const auto = [...foot.querySelectorAll('button')].find((each) =>
        each.textContent?.startsWith('Turn on auto-merge…'),
      );
      expect(auto).toBeDefined();
      click(auto!);
      expect(parts().foot.textContent).toContain('Turn off auto-merge');
    });

    it('keeps the auto-merge button busy while it works, and dims it with why it can’t', () => {
      const onClick = vi.fn<() => void>();
      frame({
        kind: 'auto',
        verdict: 'Auto-merge is on',
        foot: (
          <MergeFoot
            auto={{
              label: 'Turn off auto-merge',
              keys: ['a'],
              busy: true,
              working: 'Turning off…',
              onClick,
            }}
            primary={{ label: 'Merge #264…', keys: ['⏎'], quiet: true, reason: 'Offline' }}
          />
        ),
      });
      const [auto] = parts().foot.querySelectorAll('button');
      expect(auto?.getAttribute('aria-busy')).toBe('true');
      click(auto!);
      expect(onClick).not.toHaveBeenCalled();
      cleanUp();
      frame({
        kind: 'auto',
        verdict: 'Auto-merge is on',
        foot: (
          <MergeFoot
            auto={{ label: 'Turn off auto-merge', reason: 'Offline', onClick }}
            primary={{ label: 'Merge #264…', quiet: true, reason: 'Offline' }}
          />
        ),
      });
      const [dimmed] = parts().foot.querySelectorAll('button');
      expect(dimmed?.getAttribute('aria-disabled')).toBe('true');
      expect(dimmed?.getAttribute('aria-description')).toBe('Offline');
      // Dimmed, its tooltip is why, with no key.
      expect(tipOf(dimmed!)).toBe('Offline');
      click(dimmed!);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('the branch has a merge queue', () => {
    it('says the queue chooses, and offers to add to it', () => {
      const onQueue = vi.fn<() => void>();
      const children: ReactNode = (
        <Callout tone="info">
          The queue&apos;s settings choose the method and the message: squash, with the PR title.
        </Callout>
      );
      frame({
        kind: 'queued',
        verdict: 'Ready for the queue',
        sub: 'main merges through a queue · 4 ahead, about 18 min',
        children,
        foot: (
          <MergeFoot
            start={
              <Button variant="ghost" size="sm">
                See the queue <Key keys={['g', 'q']} quiet decorative />
              </Button>
            }
            primary={{ label: 'Add to merge queue', keys: ['⏎'], onClick: onQueue }}
          />
        ),
      });
      const { head, body, foot } = parts();
      expect(head.querySelector('.bg-queue')).not.toBeNull();
      expect(head.textContent).toContain('4 ahead, about 18 min');
      expect(body?.textContent).toContain("The queue's settings choose the method");
      // No auto-merge button here: the queue does the waiting.
      expect(foot.textContent).not.toContain('auto-merge');
      expect(foot.textContent).toContain('See the queue');
      const primary = [...foot.querySelectorAll('button')].at(-1);
      expect(primary?.textContent).toContain('Add to merge queue');
      click(primary!);
      expect(onQueue).toHaveBeenCalledOnce();
    });
  });

  describe('auto-merge is on', () => {
    it('lists what it waits for, with auto-merge to turn off and merging not the next thing', () => {
      const onMerge = vi.fn<() => void>();
      const rows: CheckItem[] = [
        {
          key: 'approved',
          kind: 'ok',
          glyph: 'ok',
          title: 'Approved',
          detail: 'by tess-okafor and jun-park',
        },
        {
          key: 'checks',
          kind: 'wait',
          glyph: 'running',
          title: 'Waiting on 2 checks',
          detail: 'e2e (chromium), typecheck',
        },
      ];
      frame({
        kind: 'auto',
        verdict: 'Merges when ready',
        sub: 'Auto-merge on · squash',
        children: <Checklist id="reasons" label="What it waits for" rows={rows} />,
        foot: (
          <MergeFoot
            auto={{ label: 'Turn off auto-merge', keys: ['a'], onClick: () => undefined }}
            primary={{ label: 'Merge', keys: ['⏎'], disabled: true, quiet: true, onClick: onMerge }}
          />
        ),
      });
      const { head, foot } = parts();
      expect(head.querySelector('.bg-accent')).not.toBeNull();
      expect(foot.textContent).toContain('Turn off auto-merge');
      const primary = [...foot.querySelectorAll('button')].at(-1);
      // Not the main button, and it can't be pressed: it still shows why by being there.
      expect(primary?.className).not.toContain('bg-accent');
      expect(primary?.getAttribute('aria-disabled')).toBe('true');
      click(primary!);
      expect(onMerge).not.toHaveBeenCalled();
    });
  });

  describe('blocks Lo cannot mend', () => {
    it('draws conflicts, a draft, a rule Lo does not check, and a block it cannot explain', () => {
      const onGitHub = vi.fn<() => void>();
      const rows: CheckItem[] = [
        { key: 'conflict', kind: 'fail', glyph: 'conflict', title: 'Conflicts with main' },
        {
          key: 'draft',
          kind: 'info',
          glyph: 'draft',
          title: 'This is a draft',
          detail: 'The author marks it ready on GitHub.',
        },
        {
          key: 'rule',
          kind: 'fail',
          glyph: 'rule',
          title: "main requires signed commits, which Lo doesn't check.",
        },
        {
          key: 'unknown',
          kind: 'wait',
          glyph: 'unknown',
          title: 'GitHub says no, and not why',
          detail: 'Lo checked reviews, checks, conversations and rules.',
          link: { label: 'See it on GitHub ↗', onOpen: onGitHub },
        },
      ];
      frame({
        kind: 'blocked',
        verdict: "Can't merge",
        sub: 'into main · 4 things in the way',
        children: <Checklist id="reasons" label="Why it can't merge" rows={rows} />,
        foot: <MergeFoot method="Merge commit" primary={{ label: 'Merge', disabled: true }} />,
      });
      const { head, body, foot } = parts();
      expect(head.querySelector('.bg-danger')).not.toBeNull();
      expect(
        [...(body?.querySelectorAll('li[data-key]') ?? [])].map((each) => each.textContent),
      ).toEqual([
        'Conflicts with main',
        'This is a draftThe author marks it ready on GitHub.',
        "main requires signed commits, which Lo doesn't check.",
        'GitHub says no, and not whyLo checked reviews, checks, conversations and rules.See it on GitHub ↗',
      ]);
      click(body!.querySelector('li[data-key="unknown"] button')!);
      expect(onGitHub).toHaveBeenCalledOnce();
      // With no auto-merge to turn on, the foot is the method and a main button that can't be
      // pressed.
      expect(foot.textContent).not.toContain('auto-merge');
      expect(foot.textContent).toContain('Merge commit');
      expect(foot.querySelector('button')?.getAttribute('aria-disabled')).toBe('true');
    });
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    frame({
      kind: 'waiting',
      verdict: "Can't merge yet",
      sub: <Branch name="main" base />,
      children: (
        <>
          <Checklist id="reasons" label="Why" rows={unmet} />
          <MergeMethods
            methods={[{ value: 'squash', label: 'Squash' }]}
            value="squash"
            onChange={() => undefined}
            note="Only squash"
          />
          <CommitText
            title={{ value: '', onChange: () => undefined }}
            message={{ value: '', onChange: () => undefined }}
          />
        </>
      ),
      foot: (
        <MergeFoot
          auto={{ label: 'Turn on auto-merge…', keys: ['a'], onClick: () => undefined }}
          start={<span>start</span>}
          method="Squash"
          primary={{ label: 'Merge', keys: ['⏎'], busy: true, working: 'Checking…' }}
        />
      ),
    });
    expect(await missingRules(document.body)).toEqual([]);
  });
});
