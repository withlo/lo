// An image figure, drawn on a canvas and never given a URL: no `img`, no `blob:` or `data:`
// address, nothing a page could open, sniff or navigate to, and nothing the window's content
// security policy has to allow. The checked bytes go into a `Blob` of the checked type, which
// `createImageBitmap` decodes, turned as its Exif data says and at the size it's drawn: that's
// only ever an image's first frame, so an animated GIF, APNG or WebP shows still.
//
// The figure's box is laid out from the size the check read, before anything is decoded, so
// nothing moves when it is. A bitmap that comes back at another size than that box says it isn't
// the image the check read, and is left out.

import { imageOrientation, isTurned, type ImageType } from '@lo/artifact';

import { decodes, type Decodes } from './decodes.ts';

/**
 * The tallest a figure is drawn, in CSS pixels: a taller one is drawn smaller, by its width, and
 * never cut. `overview.css` holds a figure's box to the same height.
 */
export const TALLEST = 960;

/** A size in pixels. */
export interface Size {
  width: number;
  height: number;
}

/**
 * The size an image figure is drawn at: the size its header gives, with width and height traded
 * when its Exif data turns it a quarter.
 */
export function imageSize(type: ImageType, size: Size, bytes: Uint8Array): Size {
  if (type !== 'jpeg' && type !== 'png') return size;
  return isTurned(imageOrientation(bytes)) ? { width: size.height, height: size.width } : size;
}

/**
 * The widest a figure of `size`'s proportions is drawn, in CSS pixels, so it's at most
 * {@link TALLEST} tall, and no wider than `most`.
 */
export function widest(size: Size, most = Infinity): number {
  return Math.min(most, (TALLEST * size.width) / size.height);
}

/** Why an image the check kept was left out as it was drawn. */
export type DrawFailure = 'decode' | 'size';

export interface ImageInit {
  canvas: HTMLCanvasElement;
  type: ImageType;
  /** The bytes the check read, whole. */
  bytes: Uint8Array<ArrayBuffer>;
  /** The size it's laid out at, from {@link imageSize}. */
  size: Size;
  /** What scrolls it, or undefined for the window. */
  root: Element | undefined;
  /** Called once if it can't be drawn: it didn't decode, or decoded at another size. */
  failed: (why: DrawFailure) => void;
  /** The queue its decodes wait in: the window's, unless a test gives its own. */
  queue?: Decodes | undefined;
}

/** How far from the screen a figure is decoded: a screen's height either way. */
const NEAR = '100% 0px';
/** How far from the screen a figure's pixels are given back: three screens' heights either way. */
const FAR = '300% 0px';

/**
 * Draws an image figure on `canvas`, decoding it when it's near the screen, one decode at a time
 * across the window, and again when its box changes width. Far off the screen, the canvas gives
 * its pixels back. Returns a function that stops it all and gives them back.
 */
export function showImage(init: ImageInit): () => void {
  const { canvas, type, bytes, size, root, failed } = init;
  const queue = init.queue ?? decodes;
  let near = false;
  let stopped = false;
  /** Whether a decode waits for its turn, or is running. */
  let state: 'idle' | 'waiting' | 'decoding' = 'idle';
  let withdraw: (() => void) | undefined;
  /** The width in device pixels it was drawn at, or 0 while it holds no pixels. */
  let drawn = 0;

  /** How wide its box is in device pixels: what it's decoded at, up to its own width. */
  const target = (): number =>
    Math.min(size.width, Math.round(canvas.getBoundingClientRect().width * devicePixelRatio));

  const cancel = (): void => {
    if (state === 'waiting') {
      withdraw?.();
      state = 'idle';
    }
    withdraw = undefined;
  };

  const giveBack = (): void => {
    cancel();
    if (canvas.width !== 0 || canvas.height !== 0) {
      canvas.width = 0;
      canvas.height = 0;
    }
    drawn = 0;
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    nearby.disconnect();
    faraway.disconnect();
    resized.disconnect();
    giveBack();
  };

  const fail = (why: DrawFailure): void => {
    stop();
    failed(why);
  };

  const decode = async (): Promise<void> => {
    const width = target();
    if (stopped || !near || width <= 0 || width === drawn) return;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${type}` }), {
        imageOrientation: 'from-image',
        // The width alone: the height follows from the image's own proportions, so a bitmap of
        // another height is another image than the one the check read.
        resizeWidth: width,
        resizeQuality: 'high',
      });
    } catch {
      if (!stopped) fail('decode');
      return;
    }
    try {
      // Moved away while it decoded: it's decoded again when it comes back.
      if (stopped || !near) return;
      const height = (width * size.height) / size.width;
      if (bitmap.width !== width || Math.abs(bitmap.height - height) > 1) {
        fail('size');
        return;
      }
      const context = canvas.getContext('2d');
      if (!context) {
        fail('decode');
        return;
      }
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      context.drawImage(bitmap, 0, 0);
      drawn = width;
    } finally {
      bitmap.close();
    }
  };

  const run = async (): Promise<void> => {
    state = 'decoding';
    withdraw = undefined;
    try {
      await decode();
    } finally {
      state = 'idle';
    }
    // Its box may have changed width while it decoded.
    ask();
  };

  const ask = (): void => {
    if (stopped || !near || state !== 'idle') return;
    const width = target();
    if (width <= 0 || width === drawn) return;
    state = 'waiting';
    const withdrawn = queue.ask(run);
    // Unless it began at once.
    if (state === 'waiting') withdraw = withdrawn;
  };

  const nearby = new IntersectionObserver(
    (entries) => {
      near = entries.at(-1)?.isIntersecting ?? near;
      if (near) ask();
      else cancel();
    },
    { root, rootMargin: NEAR },
  );
  const faraway = new IntersectionObserver(
    (entries) => {
      if (entries.at(-1)?.isIntersecting === false) giveBack();
    },
    { root, rootMargin: FAR },
  );
  const resized = new ResizeObserver(() => ask());
  nearby.observe(canvas);
  faraway.observe(canvas);
  resized.observe(canvas);
  return stop;
}

/** The nearest element above `element` that scrolls, which says what's near the screen. */
export function scroller(element: Element): Element | undefined {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === 'auto' || overflowY === 'scroll') return at;
  }
  return undefined;
}
