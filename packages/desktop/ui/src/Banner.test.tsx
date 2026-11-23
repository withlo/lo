// @vitest-environment jsdom
// A tab's banner, drawn as a tab draws it, one at a time with "+1" for the rest: it tells the tab
// what it drew once it's drawn, and keeps focus in its row as one banner gives way to the next.

import { act, useRef, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cleanUp, click, focus, render } from '../test/dom.ts';
import { Banner, BannerDrawn, BannerPlaceProvider, type BannerProps } from './Banner.tsx';
import { Swap } from './Collapse.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(cleanUp);

/** Lets focus that's handed on, a microtask on, land. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** A banner as the tab holds it: its title, and whether it has a button besides Dismiss. */
interface Shown {
  readonly title: string;
  readonly action?: boolean;
}

/**
 * A tab's banner row with `banners`, the first shown, "+1" moving to the next round the end, and
 * Dismiss putting the one shown away. The view under the row is `#view`.
 */
function Row({ banners }: { banners: readonly Shown[] }) {
  const [left, setLeft] = useState(banners);
  const [at, setAt] = useState(0);
  const row = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLButtonElement>(null);
  const shown = left[at % Math.max(1, left.length)];
  return (
    <>
      <div ref={row}>
        <BannerPlaceProvider
          value={{
            more:
              left.length > 1
                ? { count: left.length - 1, next: () => setAt((at + 1) % left.length) }
                : undefined,
            row,
            view: { focus: () => view.current?.focus() },
          }}
        >
          <Swap id={shown?.title ?? 'none'}>
            {shown && (
              <Banner
                tone="info"
                title={shown.title}
                action={shown.action ? { label: 'Show r5', onClick: () => {} } : undefined}
                onDismiss={() => {
                  setLeft(left.filter((each) => each !== shown));
                  setAt(0);
                }}
              />
            )}
          </Swap>
        </BannerPlaceProvider>
      </div>
      <button id="view" ref={view} type="button">
        The diff
      </button>
    </>
  );
}

const named = (host: HTMLElement, label: string) =>
  host.querySelector<HTMLElement>(`[aria-label^="${label}"]`)!;

describe('Banner', () => {
  it('tells the tab what it drew once it’s drawn, not while it draws', () => {
    const drawn = vi.fn<(props: BannerProps) => void>();
    render(
      <BannerDrawn value={drawn}>
        <Banner tone="warn" title="#264 left the merge queue" />
      </BannerDrawn>,
    );
    expect(drawn).toHaveBeenCalledWith({ tone: 'warn', title: '#264 left the merge queue' });
  });

  it('hands focus from "+1" to the next banner’s "+1"', async () => {
    const host = render(
      <Row banners={[{ title: 'ravi-k pushed r5' }, { title: '#264 left the merge queue' }]} />,
    );
    focus(named(host, 'Next'));
    click(named(host, 'Next'));
    await settle();
    expect(host.textContent).toContain('#264 left the merge queue');
    expect(document.activeElement).toBe(named(host, 'Next'));
  });

  it('hands focus from Dismiss to the same button on the banner that takes its place', async () => {
    const two = render(
      <Row banners={[{ title: 'ravi-k pushed r5' }, { title: 'Merged #264', action: true }]} />,
    );
    focus(named(two, 'Dismiss'));
    click(named(two, 'Dismiss'));
    await settle();
    expect(two.textContent).toContain('Merged #264');
    expect(two.querySelector('[aria-label^="Next"]')).toBeNull();
    expect(document.activeElement).toBe(named(two, 'Dismiss'));
  });

  it('hands focus from Dismiss to the view under the row once it was the last', async () => {
    const host = render(<Row banners={[{ title: 'ravi-k pushed r5', action: true }]} />);
    focus(named(host, 'Dismiss'));
    click(named(host, 'Dismiss'));
    await settle();
    expect(host.textContent).not.toContain('ravi-k pushed r5');
    expect(document.activeElement).toBe(host.querySelector('#view'));
  });

  it('leaves focus that was elsewhere where it is', async () => {
    const host = render(<Row banners={[{ title: 'ravi-k pushed r5' }]} />);
    const view = host.querySelector<HTMLElement>('#view')!;
    focus(view);
    click(named(host, 'Dismiss'));
    await settle();
    expect(document.activeElement).toBe(view);
  });
});
