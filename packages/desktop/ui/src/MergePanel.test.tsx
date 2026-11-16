// @vitest-environment jsdom
// The merge panel's frame, in each state it takes: why it can't merge, ready to merge with
// the commit's text, ready for a queue, waiting on auto-merge, and blocks Lo can't mend.

import { act, useState, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, press, render, rerender } from '../test/dom.ts';
import { Branch } from './Branch.tsx';
import { Button } from './Button.tsx';
import { Callout } from './Callout.tsx';
import { Checklist, type CheckItem } from './Checklist.tsx';
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
          auto={{ on: auto, onChange: setAuto, keys: ['a'] }}
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

describe('MergePanel', () => {
  it('opens as a dialog named Merge, in the scope its keys apply in, with a head, body and foot', () => {
    frame({
      kind: 'waiting',
      verdict: "Can't merge yet",
      sub: (
        <>
          into <Branch name="ravi/plan-limits" base /> · 6 things in the way
        </>
      ),
      children: <Checklist label="Why it can't merge" rows={unmet} />,
      foot: (
        <MergeFoot
          auto={{ on: false, onChange: () => undefined, keys: ['a'] }}
          method="Squash"
          primary={{ label: 'Merge', keys: ['⏎'], disabled: true }}
        />
      ),
    });
    const dialog = panel();
    expect(dialog.getAttribute('aria-label')).toBe('Merge');
    expect(dialog.getAttribute('data-lo-scope')).toBe('merge');
    expect(dialog.getAttribute('data-kind')).toBe('waiting');
    expect(dialog.children).toHaveLength(3);
    const { head, body, foot } = parts();
    expect(head.textContent).toContain("Can't merge yet");
    expect(head.textContent).toContain('into ravi/plan-limits · 6 things in the way');
    // The dot is the verdict's color, and there's a way to close it by key.
    expect(head.querySelector('.bg-warning')).not.toBeNull();
    expect(head.querySelector('button')?.getAttribute('aria-label')).toBe('Close (Esc)');
    expect(body?.querySelectorAll('li[data-key]')).toHaveLength(2);
    expect(foot.textContent).toContain('Merge when ready');
    expect(foot.textContent).toContain('Squash');
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
    frame({ kind: 'ready', verdict: 'Ready ‮to merge' });
    expect(panel().innerHTML).not.toMatch(/[‪-‮⁦-⁩]/);
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

    it('presses merge, and turns on merge when ready', () => {
      const onMerge = vi.fn<() => void>();
      open(onMerge);
      const { foot } = parts();
      const primary = [...foot.querySelectorAll('button')].find(
        (each) => each.getAttribute('role') !== 'switch',
      );
      expect(primary?.textContent).toContain('Squash and merge');
      expect(primary?.className).toContain('bg-accent');
      click(primary!);
      expect(onMerge).toHaveBeenCalledOnce();
      const switchEl = foot.querySelector('[role="switch"]');
      expect(switchEl?.getAttribute('aria-checked')).toBe('false');
      expect(switchEl?.getAttribute('aria-label')).toBe('Merge when ready');
      click(switchEl!);
      expect(parts().foot.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe(
        'true',
      );
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
      // No switch here: the queue does the waiting.
      expect(foot.querySelector('[role="switch"]')).toBeNull();
      expect(foot.textContent).toContain('See the queue');
      const primary = [...foot.querySelectorAll('button')].at(-1);
      expect(primary?.textContent).toContain('Add to merge queue');
      click(primary!);
      expect(onQueue).toHaveBeenCalledOnce();
    });
  });

  describe('auto-merge is on', () => {
    it('lists what it waits for, with the switch on and merging not the next thing', () => {
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
        children: <Checklist label="What it waits for" rows={rows} />,
        foot: (
          <MergeFoot
            auto={{ on: true, onChange: () => undefined, keys: ['a'] }}
            primary={{ label: 'Merge', keys: ['⏎'], disabled: true, quiet: true, onClick: onMerge }}
          />
        ),
      });
      const { head, foot } = parts();
      expect(head.querySelector('.bg-accent')).not.toBeNull();
      expect(foot.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
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
          detail: (
            <>
              Lo checked reviews, checks, conversations and rules.{' '}
              <button type="button" onClick={onGitHub}>
                See it on GitHub ↗
              </button>
            </>
          ),
        },
      ];
      frame({
        kind: 'blocked',
        verdict: "Can't merge",
        sub: 'into main · 4 things in the way',
        children: <Checklist label="Why it can't merge" rows={rows} />,
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
        'GitHub says no, and not whyLo checked reviews, checks, conversations and rules. See it on GitHub ↗',
      ]);
      // With nothing to switch, the foot is the method and a main button that can't be pressed.
      expect(foot.querySelector('[role="switch"]')).toBeNull();
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
          <Checklist label="Why" rows={unmet} />
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
          auto={{ on: false, onChange: () => undefined, keys: ['a'] }}
          start={<span>start</span>}
          method="Squash"
          primary={{ label: 'Merge', keys: ['⏎'] }}
        />
      ),
    });
    expect(await missingRules(document.body)).toEqual([]);
  });
});
