// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { RenderThread, ThreadView } from './api.ts';
import { type ThreadHost, Threads } from './threads.ts';

const real = globalThis.ResizeObserver;

beforeEach(() => {
  // jsdom has no resize observer: the tests hand `resized` what one would have seen.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  // Every element is drawn; jsdom lays nothing out.
  const rect = new DOMRect(0, 0, 100, 10);
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue(
    Object.assign([rect], { item: () => rect }),
  );
});

afterEach(() => {
  globalThis.ResizeObserver = real;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function thread(id: string, open = true, version = 1, line = 1): ThreadView {
  return { id, at: { file: 'a', side: 'new', line }, open, version };
}

/** What the caller was asked to draw, in turn. */
function caller() {
  const asked: string[] = [];
  const render: RenderThread = (host, shown) => {
    asked.push(`draw ${shown.id} ${shown.open ? 'open' : 'collapsed'} v${shown.version}`);
    return {
      update: (next) =>
        asked.push(`update ${next.id} ${next.open ? 'open' : 'collapsed'} v${next.version}`),
      destroy: () => asked.push(`destroy ${shown.id}`),
    };
  };
  return { render, asked };
}

/** The caller's content of `host` measured `height` tall and `width` wide. */
function measure(host: ThreadHost, height: number, width = 300): ResizeObserverEntry {
  return sized(host.host, height, width);
}

/** What a resize observer says of `target`, `height` tall and `width` wide. */
function sized(target: Element, height: number, width: number): ResizeObserverEntry {
  const size = { blockSize: height, inlineSize: width };
  return {
    target,
    borderBoxSize: [size],
    contentBoxSize: [size],
    devicePixelContentBoxSize: [size],
    contentRect: new DOMRect(0, 0, width, height),
  };
}

/** Threads whose hosts are in the page. */
function threads() {
  const made = new Threads(() => {});
  const { render, asked } = caller();
  made.render = render;
  const take = (shown: ThreadView): ThreadHost => {
    made.take(shown);
    const host = made.get(shown.id)!;
    if (!host.dom.isConnected) document.body.append(host.dom);
    return host;
  };
  return { made, take, asked };
}

describe('a thread', () => {
  test('is drawn once, when the view first draws it, and again only when what it shows changes', () => {
    const { made, take, asked } = threads();
    const host = take(thread('one'));
    expect(asked).toEqual([]);
    made.draw(host);
    made.draw(host);
    expect(asked).toEqual(['draw one open v1']);
    take(thread('one'));
    take(thread('one', true, 2));
    take(thread('one', true, 2, 4));
    expect(asked).toEqual(['draw one open v1', 'update one open v2', 'update one open v2']);
    made.drop((each) => each.id === 'one');
    expect(asked.at(-1)).toBe('destroy one');
    expect(host.dom.isConnected).toBe(false);
  });

  test('stays open or collapsed as the reader left it until the caller says otherwise', () => {
    const { made, take, asked } = threads();
    const host = take(thread('one'));
    made.draw(host);
    host.setOpen(false);
    take(thread('one', true, 2));
    expect(host.open).toBe(false);
    take(thread('one', false, 2));
    take(thread('one', true, 2));
    expect(host.open).toBe(true);
    expect(asked).toEqual([
      'draw one open v1',
      'update one collapsed v1',
      'update one collapsed v2',
      'update one open v2',
    ]);
  });

  test('is guessed at, then as tall as it was measured, open or collapsed as it was', () => {
    const { take } = threads();
    const host = take(thread('one'));
    expect(host.estimate).toBe(120);
    host.measured(64, 100);
    expect(host.estimate).toBe(64);
    host.setOpen(false);
    expect(host.estimate).toBe(36);
    host.pin(50);
    expect(host.estimate).toBe(50);
    expect(host.dom.style.height).toBe('50px');
    host.unpin();
    expect(host.dom.style.height).toBe('');
  });
});

describe('sizes', () => {
  test('once measured, it keeps that height, and hears of each change until it’s let go', () => {
    const { made, take } = threads();
    const one = take(thread('one'));
    const two = take(thread('two'));
    expect(made.resized([measure(one, 40), measure(two, 30)])).toEqual([]);
    expect(one.dom.style.height).toBe('40px');
    two.hold();
    const changed = made.resized([measure(one, 70), measure(two, 90)]);
    expect(changed).toEqual([{ host: one, fresh: false, reflowed: false }]);
    expect([one.dom.style.height, two.dom.style.height]).toEqual(['40px', '30px']);
    expect(made.resized([measure(one, 80)])).toEqual([
      { host: one, fresh: false, reflowed: false },
    ]);
    one.letGo();
    two.letGo();
    expect([one.dom.style.height, two.dom.style.height]).toEqual(['80px', '90px']);
    expect(two.dom.classList.contains('is-held')).toBe(false);
    expect(made.resized([measure(one, 80, 300)])).toEqual([]);
    expect(made.resized([measure(one, 120, 200)])).toEqual([
      { host: one, fresh: false, reflowed: true },
    ]);
  });

  test('content that comes after the host is first drawn empty is fresh, not a change', () => {
    const { made, take } = threads();
    const one = take(thread('one'));
    made.resized([measure(one, 0)]);
    expect(made.resized([measure(one, 80)])).toEqual([{ host: one, fresh: true, reflowed: false }]);
    one.letGo();
    expect(made.resized([measure(one, 90)])).toEqual([
      { host: one, fresh: false, reflowed: false },
    ]);
  });

  test('a host out of the page takes its content’s height, and is measured afresh once back', () => {
    const { made, take } = threads();
    const one = take(thread('one'));
    made.resized([measure(one, 40)]);
    one.dom.remove();
    expect(made.resized([measure(one, 0)])).toEqual([]);
    expect(one.drawn).toBe(false);
    expect(one.dom.style.height).toBe('');
    document.body.append(one.dom);
    expect(made.resized([measure(one, 60)])).toEqual([]);
    expect(one.dom.style.height).toBe('60px');
  });

  test('a change the reader made is theirs once: one they asked for, or one the next frame lays out', async () => {
    const { made, take } = threads();
    const one = take(thread('one'));
    made.draw(one);
    one.setOpen(false);
    expect(one.takeInput()).toBe(true);
    expect(one.takeInput()).toBe(false);
    // What the caller changes at the reader's asking, until it changes something of its own.
    expect(made.take(thread('one', true, 2), true)).toBe(true);
    expect(one.takeInput()).toBe(true);
    made.take(thread('one', true, 3), true);
    made.take(thread('one', true, 4));
    expect(one.takeInput()).toBe(false);
    // A pointer or key in it, for what the next frame lays out.
    one.touched();
    expect(one.takeInput()).toBe(true);
    one.touched();
    await frame();
    await frame();
    expect(one.takeInput()).toBe(false);
  });
});

/** Waits for the page's next frame. */
function frame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
