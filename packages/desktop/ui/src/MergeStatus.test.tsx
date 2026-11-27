// @vitest-environment jsdom
// The merge status in the header: a dot and one line for each way a pull request can stand on
// merging, and where the header draws it.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, render, tipOf } from '../test/dom.ts';
import { MergeStatus, type MergeKind } from './MergeStatus.tsx';
import { PRHeader } from './PRHeader.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

/** Each kind with the line it shows, and the color of its dot. */
const KINDS: readonly { kind: MergeKind; verdict: string; detail?: string; dot: string }[] = [
  { kind: 'ready', verdict: 'Ready to merge', detail: 'Squash into main', dot: 'bg-success' },
  {
    kind: 'waiting',
    verdict: "Can't merge yet",
    detail: 'Review required · 2 checks running',
    dot: 'bg-warning',
  },
  { kind: 'blocked', verdict: "Can't merge", detail: 'Conflicts · draft', dot: 'bg-danger' },
  { kind: 'queued', verdict: 'Queued, 3rd', detail: 'about 12 min', dot: 'bg-queue' },
  { kind: 'auto', verdict: 'Merges when ready', detail: 'Auto-merge on', dot: 'bg-accent' },
  { kind: 'merged', verdict: 'Merged', dot: 'bg-state-merged' },
  { kind: 'closed', verdict: 'Closed', dot: 'bg-state-closed' },
];

describe('MergeStatus', () => {
  it.each(KINDS)('says $verdict, with a dot of its own color', ({ kind, verdict, detail, dot }) => {
    const host = render(
      <MergeStatus
        kind={kind}
        verdict={verdict}
        detail={detail}
        keys={['m']}
        onClick={vi.fn<() => void>()}
      />,
    );
    const button = host.querySelector('button');
    expect(button?.querySelector('strong')?.textContent).toBe(verdict);
    // One line: the verdict, then the reasons or the method.
    expect(button?.textContent).toBe(`${verdict}${detail ?? ''}m`);
    const mark = button?.querySelector('span[aria-hidden="true"]');
    expect(mark?.className).toContain(dot);
    expect(mark?.className).toContain('rounded-pill');
    // The dot never stands without words: its own text is empty, and the verdict is beside it.
    expect(mark?.textContent).toBe('');
  });

  it('is a button that opens the merge panel, and shows its key', () => {
    const onClick = vi.fn<() => void>();
    const host = render(
      <MergeStatus kind="ready" verdict="Ready to merge" keys={['m']} onClick={onClick} expanded />,
    );
    const button = host.querySelector('button');
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    // Its tooltip names it, with its key: Lo's, not the system's.
    expect(button?.hasAttribute('title')).toBe(false);
    expect(tipOf(button!)).toBe('Merge panelm');
    // A screen reader hears what it opens as its description, after the verdict that names it.
    expect(button?.getAttribute('aria-description')).toBe('Merge panel');
    const sequence = render(
      <MergeStatus kind="ready" verdict="Ready to merge" keys={['g', 'm']} onClick={onClick} />,
    );
    expect(sequence.querySelector('button')?.getAttribute('aria-description')).toBe(
      'Merge panel, Keys g then m',
    );
    expect(button?.querySelector('kbd')?.getAttribute('aria-hidden')).toBe('true');
    click(button!);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('fills its dot once, as a merge lands with nothing else to say so', () => {
    const still = render(<MergeStatus kind="merged" verdict="Merged" />);
    expect(still.querySelector('span[aria-hidden="true"]')?.className).not.toContain('move-fill');
    const landed = render(<MergeStatus kind="merged" verdict="Merged" landed />);
    expect(landed.querySelector('span[aria-hidden="true"]')?.className).toContain('move-fill');
  });

  it('is only a line once there is nothing to open, with no key', () => {
    const host = render(<MergeStatus kind="merged" verdict="Merged" keys={['m']} />);
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('kbd')).toBeNull();
    expect(host.textContent).toBe('Merged');
  });

  it('is never cut: the row it’s in gives up its reasons, then its verdict, each whole and still heard', () => {
    const host = render(
      <MergeStatus
        kind="waiting"
        verdict="Can't merge yet"
        detail="Review required · 2 checks running"
        onClick={vi.fn<() => void>()}
      />,
    );
    expect(host.querySelector('button')?.className).toContain('flex-none');
    const verdict = host.querySelector('strong');
    expect(verdict?.className).toContain('flex-none');
    expect(verdict?.getAttribute('data-gives')).toBe('title');
    const reasons = host.querySelector('[data-gives="detail"]');
    expect(reasons?.textContent).toBe('Review required · 2 checks running');
    expect(reasons?.className).toContain('flex-none');
    expect(reasons?.className).not.toContain('truncate');
    // Given up, it's out of sight, not gone: nothing else says it.
    expect(reasons?.hasAttribute('data-heard')).toBe(true);
  });

  it('draws what a branch’s name says without the characters that turn text around', () => {
    const host = render(
      <MergeStatus kind="ready" verdict="Ready to merge" detail={'Squash into ma\u202Ein'} />,
    );
    expect(host.innerHTML).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    expect(host.textContent).toContain('Squash into main');
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <>
        {KINDS.map((each) => (
          <MergeStatus key={each.kind} {...each} keys={['m']} onClick={vi.fn<() => void>()} />
        ))}
        <MergeStatus kind="merged" verdict="Merged" />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});

describe('PRHeader’s status', () => {
  const status = (
    <MergeStatus kind="waiting" verdict="Can't merge yet" onClick={vi.fn<() => void>()} />
  );

  it('draws it on the first row, between the connection chip and the account', () => {
    const host = render(
      <PRHeader
        number={4821}
        title="Rate limit GraphQL queries by cost"
        state="open"
        author="ravi-k"
        head={{ branch: 'ravi/graphql-cost' }}
        base={{ branch: 'ravi/plan-limits' }}
        acting={{ login: 'tess-okafor' }}
        connection={{ kind: 'offline', tone: 'warn', label: 'Offline' }}
        status={status}
      >
        <span>Comparing</span>
      </PRHeader>,
    );
    const [first, second] = host.querySelectorAll('header > div');
    const order = [...(first?.children ?? [])].map((each) => each.textContent ?? '');
    const at = (text: string) => order.findIndex((each) => each.includes(text));
    expect(at('Offline')).toBeGreaterThan(-1);
    expect(at("Can't merge yet")).toBeGreaterThan(at('Offline'));
    expect(at('tess-okafor')).toBeGreaterThan(at("Can't merge yet"));
    // The children stay the second row's.
    expect(second?.textContent).toContain('Comparing');
    expect(second?.textContent).not.toContain("Can't merge yet");
    expect(first?.textContent).not.toContain('Comparing');
  });

  it('draws nothing where it has none', () => {
    const host = render(<PRHeader number={1} title="A" state="open" acting={{ login: 'x' }} />);
    expect(host.querySelector('button')).toBeNull();
  });
});
