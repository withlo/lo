// @vitest-environment jsdom
// What a status item's details, and the header chip's, do with focus as they end while they have
// it, as an action in them that changes what's behind them does: it goes back to the item, or the
// chip, as it's drawn now, else beside it, never to the page. And the keys typed so far.

import { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanUp, click, render } from '../test/dom.ts';
import { PRHeader } from './PRHeader.tsx';
import { StatusBar, StatusItem, StatusKeys } from './StatusBar.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(cleanUp);

/** Lets the details take focus as they mount, and focus handed on land. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The details, once open: Base UI draws them into the page's body. */
const details = () => document.body.querySelector<HTMLElement>('[role="dialog"]');

/**
 * A local copy's item whose details hold "Try now", which fetches: then it has nothing behind it,
 * as an item with no details is text; or, with `gone`, it leaves the bar, before `#after`.
 */
function Local({ gone = false }: { gone?: boolean }) {
  const [failed, setFailed] = useState(true);
  return (
    <StatusBar
      start={
        <>
          {(failed || !gone) && (
            <StatusItem
              ball={failed ? 'failed' : 'ready'}
              details={
                failed ? (
                  <button type="button" onClick={() => setFailed(false)}>
                    Try now
                  </button>
                ) : undefined
              }
            >
              {failed ? 'Can’t fetch the local copy' : 'Local copy'}
            </StatusItem>
          )}
          <button type="button" id="after">
            After
          </button>
        </>
      }
    />
  );
}

/** A header whose chip's details hold "Try again", which brings the tab back online. */
function Header() {
  const [offline, setOffline] = useState(true);
  return (
    <PRHeader
      number={80}
      connection={
        offline
          ? {
              kind: 'offline',
              tone: 'warn',
              label: 'Offline',
              details: (
                <button type="button" onClick={() => setOffline(false)}>
                  Try again
                </button>
              ),
            }
          : undefined
      }
      status={
        <button type="button" id="status">
          Can merge
        </button>
      }
    />
  );
}

/** Opens the details over `trigger`, then presses their only button. */
async function pressInDetails(trigger: HTMLElement): Promise<void> {
  click(trigger);
  await settle();
  const button = details()?.querySelector('button');
  expect(button).toBeDefined();
  act(() => button?.focus());
  click(button!);
  await settle();
}

describe('the details of a status item, and of the header’s chip', () => {
  it('give focus back to their item as it’s drawn now, once they end', async () => {
    const host = render(<Local />);
    await pressInDetails(host.querySelector('button')!);
    expect(details()).toBeNull();
    const item = host.querySelector('footer span')!;
    expect(item.textContent).toContain('Local copy');
    expect(document.activeElement).toBe(item);
  });

  it('give focus to the bar’s next item when theirs goes too', async () => {
    const host = render(<Local gone />);
    await pressInDetails(host.querySelector('button')!);
    expect(document.activeElement).toBe(host.querySelector('#after'));
  });

  it('give focus beside the chip, once the tab is back online and the chip goes', async () => {
    const host = render(<Header />);
    await pressInDetails(host.querySelector('header button')!);
    expect(host.textContent).not.toContain('Offline');
    expect(document.activeElement).toBe(host.querySelector('#status'));
  });
});

describe('the keys typed so far', () => {
  it('draw a key’s symbol as its icon, as a key chip does, and say the keys as typed', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<StatusKeys keys="⌃w" />);
    const typed = host.querySelector('[data-lo-keys-typed]');
    expect(typed?.querySelectorAll('svg.lo-i--xs')).toHaveLength(1);
    expect(typed?.textContent).toBe('⌃w');
    expect(typed?.getAttribute('aria-label')).toBe('Keys typed: ⌃w');
  });
});
