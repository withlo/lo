// What drawing figures needs that jsdom doesn't have: it lays nothing out, observes nothing and has
// no canvas. Tests say what's near the screen, how wide a box is, and what a decode gives.

import { vi, type Mock } from 'vitest';

/** An entry saying whether `target` is within an observer's margin. */
function entry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
  const rect = new DOMRect();
  return {
    target,
    isIntersecting,
    intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: rect,
    intersectionRect: rect,
    rootBounds: null,
    time: 0,
  };
}

/** An intersection observer that calls back only when a test says so, through {@link place}. */
export class FakeIntersectionObserver implements IntersectionObserver {
  /** Every observer not disconnected. */
  static readonly all: FakeIntersectionObserver[] = [];
  /** Whether each observer is told at once that what it observes intersects. */
  static near = false;

  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly scrollMargin: string = '0px';
  readonly thresholds: readonly number[] = [0];
  readonly targets: Element[] = [];
  readonly #callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.#callback = callback;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '0px';
    FakeIntersectionObserver.all.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
    if (FakeIntersectionObserver.near) this.tell(target, true);
  }

  unobserve(target: Element): void {
    this.targets.splice(this.targets.indexOf(target), 1);
  }

  disconnect(): void {
    const all = FakeIntersectionObserver.all;
    all.splice(all.indexOf(this), 1);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  tell(target: Element, isIntersecting: boolean): void {
    this.#callback([entry(target, isIntersecting)], this);
  }
}

/** A resize observer that calls back only when a test says so, through {@link resize}. */
export class FakeResizeObserver implements ResizeObserver {
  static readonly all: FakeResizeObserver[] = [];

  readonly targets: Element[] = [];
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    FakeResizeObserver.all.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(target: Element): void {
    this.targets.splice(this.targets.indexOf(target), 1);
  }

  disconnect(): void {
    const all = FakeResizeObserver.all;
    all.splice(all.indexOf(this), 1);
  }

  tell(): void {
    this.#callback([], this);
  }
}

/** Says whether `target` is within a screen of the screen, and within three. */
export function place(target: Element, near: boolean, far = near): void {
  for (const observer of FakeIntersectionObserver.all.slice()) {
    if (!observer.targets.includes(target)) continue;
    observer.tell(target, observer.rootMargin === '100% 0px' ? near : far);
  }
}

/** Says `target`'s box changed. */
export function resize(target: Element): void {
  for (const observer of FakeResizeObserver.all.slice()) {
    if (observer.targets.includes(target)) observer.tell();
  }
}

/** Gives `element` a box `width` pixels wide, or `width()` wide when it's asked. */
export function box(element: Element, width: number | (() => number)): void {
  const measure = typeof width === 'number' ? () => width : width;
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, measure(), 0),
  });
}

/** What a decode gives: a bitmap, which says when it's closed. */
export interface FakeBitmap {
  width: number;
  height: number;
  close: Mock<() => void>;
}

export function bitmap(width: number, height: number): FakeBitmap {
  return { width, height, close: vi.fn<() => void>() };
}

/** The window as figures need it, faked; `undo` puts jsdom back. */
export interface FakeWindow {
  /** Each canvas's 2D context's `drawImage`. */
  drawImage: Mock<(image: unknown, x: number, y: number) => void>;
  /** `URL.createObjectURL`, which nothing should call. */
  createObjectURL: Mock<(object: Blob) => string>;
  undo: () => void;
}

/**
 * Fakes the observers, a canvas's 2D context and `URL.createObjectURL`, and puts `decode` in
 * `createImageBitmap`'s place.
 */
export function fakeWindow(
  decode: (blob: Blob, options: ImageBitmapOptions) => Promise<FakeBitmap>,
): FakeWindow {
  const drawImage = vi.fn<(image: unknown, x: number, y: number) => void>();
  const createObjectURL = vi.fn<(object: Blob) => string>(() => 'blob:nothing');
  const context = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ drawImage }),
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('createImageBitmap', decode);
  return {
    drawImage,
    createObjectURL,
    undo: () => {
      vi.unstubAllGlobals();
      if (context) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', context);
      Reflect.deleteProperty(URL, 'createObjectURL');
      FakeIntersectionObserver.all.length = 0;
      FakeIntersectionObserver.near = false;
      FakeResizeObserver.all.length = 0;
    },
  };
}
