// @vitest-environment jsdom
// What a merge's confirmations state: the facts, a stack's layers, and the word to type before a
// merge that skips the rules.

import { act, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, render } from '../test/dom.ts';
import { Branch } from './Branch.tsx';
import { Button } from './Button.tsx';
import { Callout } from './Callout.tsx';
import { Dialog, DialogSpacer } from './Dialog.tsx';
import { FactPerson, Facts } from './Facts.tsx';
import { Key } from './Key.tsx';
import { LayerList, type LayerRow } from './LayerList.tsx';
import { TypeToConfirm, typedMatches } from './TypeToConfirm.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
  document.body.replaceChildren();
});

/** An open dialog: Base UI draws it into the page's body. */
function dialog(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[role="dialog"]');
  if (found === null) throw new Error('No dialog is open.');
  return found;
}

const layers: LayerRow[] = [
  {
    number: 4818,
    title: 'Move the token bucket into packages/ratelimit',
    state: 'todo',
    detail: 'Approved · 14 checks passed · 12 files',
  },
  {
    number: 4819,
    title: 'Load per-plan limits from config/limits.yaml',
    state: 'todo',
    detail: 'Approved · 14 checks passed · 31 files',
  },
  {
    number: 4821,
    title: 'Rate limit GraphQL queries by cost',
    state: 'now',
    detail: 'Approved · 12 checks passed · 214 files · the one on screen',
  },
];

describe('Facts', () => {
  it('states each fact under its name, in two columns', () => {
    const host = render(
      <Facts
        items={[
          { label: 'As', value: <FactPerson login="tess-okafor" /> },
          { label: 'Method', value: 'Squash, one commit per layer' },
          { label: 'Into', value: <Branch name="main" base /> },
          { label: 'Revision', value: 'r5 of #4821, the one you reviewed' },
        ]}
      />,
    );
    const list = host.querySelector('dl');
    expect(list?.className).toContain('facts');
    expect([...host.querySelectorAll('dt')].map((each) => each.textContent)).toEqual([
      'As',
      'Method',
      'Into',
      'Revision',
    ]);
    const values = [...host.querySelectorAll('dd')];
    expect(values[0]?.textContent).toBe('TOtess-okafor');
    expect(values[0]?.querySelector('[aria-hidden="true"]')?.textContent).toBe('TO');
    expect(values[1]?.textContent).toBe('Squash, one commit per layer');
    expect(values[2]?.querySelector('[title="main"]')?.textContent).toBe('main');
    expect(values[3]?.textContent).toBe('r5 of #4821, the one you reviewed');
  });

  it('draws a login without the characters that turn text around', () => {
    const host = render(
      <Facts items={[{ label: 'As', value: <FactPerson login={'tess‮-okafor'} /> }]} />,
    );
    expect(host.innerHTML).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(host.textContent).toContain('tess-okafor');
  });
});

describe('LayerList', () => {
  it('lists every layer that will merge, bottom first, and marks the one on screen', () => {
    const host = render(<LayerList label="Layers that will merge" layers={layers} />);
    const list = host.querySelector('ol');
    expect(list?.getAttribute('aria-label')).toBe('Layers that will merge');
    const items = [...host.querySelectorAll('li')];
    expect(items).toHaveLength(3);
    expect(items.map((each) => each.querySelector('strong')?.textContent)).toEqual([
      '#4818',
      '#4819',
      '#4821',
    ]);
    expect(items[0]?.textContent).toContain('Move the token bucket into packages/ratelimit');
    expect(items[0]?.textContent).toContain('Approved · 14 checks passed · 12 files');
    expect(items[2]?.textContent).toContain('the one on screen');
    expect(items.map((each) => each.getAttribute('aria-current'))).toEqual([null, null, 'step']);
  });

  it('shows how far a merge has got: done, in hand, waiting', () => {
    const host = render(
      <LayerList
        label="Layers merging"
        layers={[
          { number: 4818, title: 'First', state: 'done', detail: 'Rules passed' },
          { number: 4819, title: 'Second', state: 'now', detail: 'Checking rules', working: true },
          { number: 4821, title: 'Third', state: 'todo', detail: 'Waiting' },
        ]}
      />,
    );
    const items = [...host.querySelectorAll('li')];
    expect(items[0]?.textContent).toContain('✓');
    expect(items[0]?.textContent).toContain('Done: ');
    expect(items[1]?.querySelector('.spinner')).not.toBeNull();
    expect(items[1]?.textContent).toContain('Checking rules');
    expect(items[0]?.querySelector('.spinner')).toBeNull();
    expect(items[2]?.querySelector('.spinner')).toBeNull();
    expect(items[2]?.textContent).toContain('Not yet: ');
  });

  it('says which layers landed when a merge stopped partway', () => {
    const host = render(
      <LayerList
        label="Layers merged"
        layers={[
          { number: 4818, title: 'First', state: 'done', detail: 'Merged' },
          {
            number: 4819,
            title: 'Second',
            state: 'stopped',
            detail: 'Required status check security/scan is expected.',
          },
          { number: 4821, title: 'Third', state: 'skipped', detail: 'Not merged' },
        ]}
      />,
    );
    const items = [...host.querySelectorAll('li')];
    expect(
      items.map((each) => each.querySelector('span[aria-hidden="true"]')?.textContent),
    ).toEqual(['✓', '!', '3']);
    expect(items[1]?.textContent).toContain('Required status check security/scan is expected.');
    expect(items[2]?.className).toContain('text-fg-dim');
  });

  it('draws a title as text, without the characters that turn it around', () => {
    const host = render(
      <LayerList
        label="Layers"
        layers={[{ number: 1, title: '<b>Move</b> ‮daer', state: 'todo' }]}
      />,
    );
    expect(host.querySelector('b')).toBeNull();
    expect(host.textContent).toContain('<b>Move</b> daer');
    expect(host.innerHTML).not.toMatch(/[‪-‮⁦-⁩]/);
  });
});

describe('typedMatches', () => {
  it.each([
    ['4821', '4821', true],
    ['  4821 ', '4821', true],
    ['48', '4821', false],
    ['4821 4', '4821', false],
    ['48210', '4821', false],
    ['', '4821', false],
  ])('%j for %j is %s', (typed, word, matches) => {
    expect(typedMatches(typed, word)).toBe(matches);
  });
});

describe('TypeToConfirm', () => {
  it('asks for the word, in a field it labels', () => {
    const onChange = vi.fn<(value: string) => void>();
    const host = render(<TypeToConfirm word="4821" value="48" onChange={onChange} />);
    const input = host.querySelector('input');
    const label = host.querySelector(`label[for="${input?.id}"]`);
    expect(label?.textContent).toBe('Type 4821 to confirm');
    expect(label?.querySelector('.code-text')?.textContent).toBe('4821');
    expect(input?.value).toBe('48');
    // It's a number, not a word to be corrected or filled in.
    expect(input?.getAttribute('autocomplete')).toBe('off');
    expect(input?.getAttribute('spellcheck')).toBe('false');
  });
});

function Override({ onMerge }: { onMerge: () => void }) {
  const [typed, setTyped] = useState('');
  const ready = typedMatches(typed, '4821');
  return (
    <Dialog
      open
      onOpenChange={() => undefined}
      title="Merge without the rules?"
      description="You can bypass main's rules as an admin of fieldwork."
      foot={
        <>
          <DialogSpacer />
          <Button>Cancel</Button>
          <Button
            variant="danger"
            aria-disabled={!ready || undefined}
            onClick={() => {
              if (ready) onMerge();
            }}
          >
            Merge anyway
          </Button>
        </>
      }
    >
      <Callout tone="danger">
        <strong>This skips:</strong>
        <ul className="m-0 list-none p-0">
          <li>1 required check that failed: test (node 20)</li>
          <li>A code owner review from @fieldwork/api-platform</li>
        </ul>
      </Callout>
      <Facts
        items={[
          { label: 'As', value: <FactPerson login="tess-okafor" /> },
          {
            label: 'Method',
            value: (
              <>
                Squash into <Branch name="ravi/plan-limits" base />
              </>
            ),
          },
        ]}
      />
      <TypeToConfirm word="4821" value={typed} onChange={setTyped} />
    </Dialog>
  );
}

describe('the merge confirmations', () => {
  it('lists a stack’s every layer, the facts and what stays open', () => {
    render(
      <Dialog
        open
        onOpenChange={() => undefined}
        title="Merge 3 layers into main?"
        description="GitHub merges them together."
        foot={
          <>
            <DialogSpacer />
            <Button>
              Cancel <Key keys={['Esc']} decorative />
            </Button>
            <Button variant="primary">
              Merge 3 layers <Key keys={['⏎']} quiet decorative />
            </Button>
          </>
        }
      >
        <Facts
          items={[
            { label: 'As', value: <FactPerson login="tess-okafor" /> },
            { label: 'Method', value: 'Squash, one commit per layer' },
            { label: 'Into', value: <Branch name="main" base /> },
            { label: 'Revision', value: 'r5 of #4821, the one on screen' },
          ]}
        />
        <LayerList label="Layers that will merge" layers={layers} />
        <Callout tone="info">
          #4824, above, stays open and moves onto main. Lo deletes no branches; the repo&apos;s own
          setting applies.
        </Callout>
      </Dialog>,
    );
    const open = dialog();
    expect(open.textContent).toContain('Merge 3 layers into main?');
    expect(open.querySelectorAll('dt')).toHaveLength(4);
    expect(open.querySelectorAll('ol > li')).toHaveLength(3);
    expect(open.textContent).toContain('#4824, above, stays open and moves onto main.');
    expect(open.textContent).toContain('Merge 3 layers');
  });

  describe('the admin override', () => {
    it('lists what it skips, and keeps its button off until the number is typed', () => {
      const onMerge = vi.fn<() => void>();
      render(<Override onMerge={onMerge} />);
      const open = dialog();
      expect(open.textContent).toContain('This skips:');
      expect(open.textContent).toContain('A code owner review from @fieldwork/api-platform');
      const merge = () =>
        [...dialog().querySelectorAll('button')].find(
          (each) => each.textContent === 'Merge anyway',
        )!;
      expect(merge().getAttribute('aria-disabled')).toBe('true');
      click(merge());
      expect(onMerge).not.toHaveBeenCalled();

      const input = dialog().querySelector('input')!;
      const type = (value: string) =>
        act(() => {
          Reflect.set(HTMLInputElement.prototype, 'value', value, input);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      type('48');
      expect(merge().getAttribute('aria-disabled')).toBe('true');
      type('4821');
      expect(merge().getAttribute('aria-disabled')).toBeNull();
      click(merge());
      expect(onMerge).toHaveBeenCalledOnce();
    });
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <>
        <Facts items={[{ label: 'As', value: <FactPerson login="tess-okafor" /> }]} />
        <LayerList
          label="Layers"
          layers={[
            ...layers,
            { number: 1, title: 'Working', state: 'now', working: true, detail: 'Checking' },
            { number: 2, title: 'Stopped', state: 'stopped' },
          ]}
        />
        <TypeToConfirm word="4821" value="" onChange={() => undefined} />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});
