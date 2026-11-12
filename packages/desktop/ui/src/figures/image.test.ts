// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ImageType } from '@lo/artifact';
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

import {
  bitmap,
  box,
  FakeIntersectionObserver,
  FakeResizeObserver,
  fakeWindow,
  place,
  resize,
  type FakeBitmap,
  type FakeWindow,
} from '../../test/figures.ts';
import { Decodes } from './decodes.ts';
import { imageSize, showImage, TALLEST, widest, type DrawFailure, type Size } from './image.ts';

// The base is named first: under jsdom, Vite rewrites `new URL('…', import.meta.url)`.
const here = import.meta.url;
const IMAGES = fileURLToPath(new URL('../../../../../testing/fixtures/artifacts/', here));

const encoder = new TextEncoder();

function join(...parts: (Uint8Array | readonly number[] | string)[]): Uint8Array<ArrayBuffer> {
  const arrays = parts.map((part) =>
    typeof part === 'string' ? encoder.encode(part) : Uint8Array.from(part),
  );
  const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of arrays) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const be16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const be32 = (value: number): number[] => [...be16(value >>> 16), ...be16(value & 0xffff)];

/** TIFF data holding one orientation entry, as Exif holds it. */
function tiff(orientation: number): Uint8Array {
  return join(
    'MM',
    [0, 42],
    be32(8),
    be16(1),
    be16(0x0112),
    be16(3),
    be32(1),
    be16(orientation),
    [0, 0],
    be32(0),
  );
}

/** A JPEG 40 by 20 as its header says, in `orientation`. */
function jpeg(orientation: number): Uint8Array<ArrayBuffer> {
  const exif = join('Exif', [0, 0], tiff(orientation));
  const sof = [0xff, 0xc0, ...be16(11), 8, ...be16(20), ...be16(40), 1, 1, 0x11, 0];
  return join(
    [0xff, 0xd8, 0xff, 0xe1],
    be16(exif.length + 2),
    exif,
    sof,
    [0xff, 0xda, 0, 2, 0xff, 0xd9],
  );
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(kind: string, data: Uint8Array | readonly number[]): Uint8Array {
  const typed = join(kind, data);
  return join(be32(data.length), typed, be32(crc32(typed)));
}

/** An APNG of two frames, 40 by 20. */
function apng(): Uint8Array<ArrayBuffer> {
  const control = (sequence: number): Uint8Array =>
    chunk('fcTL', [
      ...be32(sequence),
      ...be32(40),
      ...be32(20),
      ...be32(0),
      ...be32(0),
      0,
      1,
      0,
      100,
      0,
      0,
    ]);
  return join(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', [...be32(40), ...be32(20), 8, 2, 0, 0, 0]),
    chunk('acTL', [...be32(2), ...be32(0)]),
    control(0),
    chunk('IDAT', [0]),
    control(1),
    chunk('fdAT', [...be32(2), 0]),
    chunk('IEND', []),
  );
}

/** A PNG 40 by 20 as its header says, in `orientation`. */
function png(orientation: number): Uint8Array<ArrayBuffer> {
  return join(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', [...be32(40), ...be32(20), 8, 2, 0, 0, 0]),
    chunk('eXIf', tiff(orientation)),
    chunk('IDAT', [0]),
    chunk('IEND', []),
  );
}

const ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8];

describe('the size an image is laid out at', () => {
  test.each(ORIENTATIONS)(
    'trades width and height for Exif orientation %i when it turns',
    (value) => {
      const turned = value >= 5;
      const expected = turned ? { width: 20, height: 40 } : { width: 40, height: 20 };
      expect(imageSize('jpeg', { width: 40, height: 20 }, jpeg(value))).toEqual(expected);
      expect(imageSize('png', { width: 40, height: 20 }, png(value))).toEqual(expected);
    },
  );

  test('is the header’s for a GIF or a WebP, which Exif data doesn’t turn', () => {
    for (const type of ['gif', 'webp'] as const) {
      expect(imageSize(type, { width: 40, height: 20 }, jpeg(6))).toEqual({
        width: 40,
        height: 20,
      });
    }
  });

  test('is no wider than keeps it within the tallest a figure is drawn', () => {
    expect(TALLEST).toBe(960);
    expect(widest({ width: 1000, height: 4000 })).toBe(240);
    expect(widest({ width: 1000, height: 4000 }, 100)).toBe(100);
    expect(widest({ width: 860, height: 320 }, 860)).toBe(860);
    expect(widest({ width: 100, height: 800 })).toBe(120);
  });
});

/** What each decode was asked for: its blob and options, and how to end it. */
interface Asked {
  blob: Blob;
  options: ImageBitmapOptions;
  resolve: (bitmap: FakeBitmap) => void;
  reject: (error: unknown) => void;
}

let asked: Asked[] = [];
let page: FakeWindow;

beforeEach(() => {
  asked = [];
  page = fakeWindow(
    (blob, options) =>
      new Promise<FakeBitmap>((resolve, reject) => {
        asked.push({ blob, options, resolve, reject });
      }),
  );
});

afterEach(() => {
  page.undo();
  document.body.replaceChildren();
});

/** The decode asked for `index`th. */
function nth(index: number): Asked {
  const found = asked.at(index);
  if (!found) throw new Error(`No decode ${index} was asked for`);
  return found;
}

/**
 * What Chromium gives for a resize to `width` alone, of an image `size` once turned: its height
 * from the image's own proportions, rounded up.
 */
function decoded(width: number, size: Size): FakeBitmap {
  return bitmap(width, Math.ceil((width * size.height) / size.width));
}

/** A canvas `width` CSS pixels wide, in the page. */
function canvasOf(width: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 0;
  canvas.height = 0;
  box(canvas, width);
  document.body.append(canvas);
  return canvas;
}

/** Shows an image on a canvas `width` pixels wide, with its own queue. */
function shown(
  type: ImageType,
  bytes: Uint8Array<ArrayBuffer>,
  size: Size,
  width = 400,
): {
  canvas: HTMLCanvasElement;
  failed: Mock<(why: DrawFailure) => void>;
  stop: () => void;
  queue: Decodes;
} {
  const canvas = canvasOf(width);
  const failed = vi.fn<(why: DrawFailure) => void>();
  const queue = new Decodes();
  const stop = showImage({ canvas, type, bytes, size, root: undefined, failed, queue });
  return { canvas, failed, stop, queue };
}

async function settle(queue: Decodes): Promise<void> {
  await queue.idle();
  await Promise.resolve();
}

describe('an image figure', () => {
  test('is decoded only near the screen, from a Blob of its type, turned as it says, at its width', async () => {
    const bytes = jpeg(1);
    const { canvas, failed, queue } = shown('jpeg', bytes, { width: 40, height: 20 }, 30);
    expect(asked).toHaveLength(0);
    place(canvas, true);
    expect(asked).toHaveLength(1);
    const { blob, options } = nth(0);
    expect(blob.type).toBe('image/jpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(options).toEqual({
      imageOrientation: 'from-image',
      resizeWidth: 30,
      resizeQuality: 'high',
    });
    const made = decoded(30, { width: 40, height: 20 });
    nth(0).resolve(made);
    await settle(queue);
    expect(page.drawImage).toHaveBeenCalledExactlyOnceWith(made, 0, 0);
    expect([canvas.width, canvas.height]).toEqual([30, 15]);
    expect(made.close).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });

  test('is decoded at its box’s width in device pixels, and never wider than it is', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const first = shown('png', png(1), { width: 40, height: 20 }, 15);
    place(first.canvas, true);
    expect(nth(0).options.resizeWidth).toBe(30);
    const second = shown('png', png(1), { width: 40, height: 20 }, 400);
    place(second.canvas, true);
    expect(nth(1).options.resizeWidth).toBe(40);
  });

  test.each(ORIENTATIONS)(
    'in Exif orientation %i, is drawn turned, and laid out so',
    async (value) => {
      for (const make of [jpeg, png]) {
        const bytes = make(value);
        const type = make === jpeg ? 'jpeg' : 'png';
        const size = imageSize(type, { width: 40, height: 20 }, bytes);
        const { canvas, failed, queue } = shown(type, bytes, size);
        place(canvas, true);
        const width = nth(-1).options.resizeWidth!;
        expect(width).toBe(size.width);
        // As Chromium decodes it: turned, then sized by its width.
        const turned = value >= 5 ? { width: 20, height: 40 } : { width: 40, height: 20 };
        nth(-1).resolve(decoded(width, turned));
        await settle(queue);
        expect(failed).not.toHaveBeenCalled();
        expect([canvas.width, canvas.height]).toEqual([turned.width, turned.height]);
      }
    },
  );

  test('turned by its decoder where Lo didn’t lay it out turned, is left out', async () => {
    const { canvas, failed, queue } = shown('png', png(1), { width: 40, height: 20 });
    place(canvas, true);
    nth(0).resolve(decoded(40, { width: 20, height: 40 }));
    await settle(queue);
    expect(failed).toHaveBeenCalledExactlyOnceWith('size');
    expect(page.drawImage).not.toHaveBeenCalled();
  });

  test.each([
    ['taller', 40, 26],
    ['shorter', 40, 12],
    ['wider', 41, 21],
    ['at its own size', 800, 400],
  ])('decoded %s than its box, is left out with nothing drawn', async (_, width, height) => {
    const { canvas, failed, queue } = shown('png', png(1), { width: 40, height: 20 });
    place(canvas, true);
    const made = bitmap(width, height);
    nth(0).resolve(made);
    await settle(queue);
    expect(failed).toHaveBeenCalledExactlyOnceWith('size');
    expect(page.drawImage).not.toHaveBeenCalled();
    expect(made.close).toHaveBeenCalledOnce();
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    // It's never decoded again.
    place(canvas, false);
    place(canvas, true);
    expect(asked).toHaveLength(1);
  });

  test('that doesn’t decode is left out', async () => {
    const { canvas, failed, queue } = shown('png', png(1), { width: 40, height: 20 });
    place(canvas, true);
    nth(0).reject(new DOMException('The source image could not be decoded.', 'InvalidStateError'));
    await settle(queue);
    expect(failed).toHaveBeenCalledExactlyOnceWith('decode');
    expect(page.drawImage).not.toHaveBeenCalled();
  });

  test.each(['html.png', 'polyglot.png'])(
    '%s, a sound PNG followed by HTML, is drawn as a PNG and nothing else',
    async (name) => {
      const bytes = Uint8Array.from(readFileSync(`${IMAGES}hostile/figure-images/figures/${name}`));
      const { canvas, failed, queue } = shown('png', bytes, { width: 1, height: 1 });
      place(canvas, true);
      expect(nth(0).blob.type).toBe('image/png');
      expect(new Uint8Array(await nth(0).blob.arrayBuffer())).toEqual(bytes);
      nth(0).resolve(bitmap(1, 1));
      await settle(queue);
      expect(failed).not.toHaveBeenCalled();
      expect(page.drawImage).toHaveBeenCalledOnce();
      expect(document.body.innerHTML).toBe('<canvas width="1" height="1"></canvas>');
      expect(page.createObjectURL).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['an animated GIF', 'gif', 'valid/figures/figures/loop.gif', { width: 24, height: 12 }],
    ['an animated WebP', 'webp', 'valid/figures/figures/moving.webp', { width: 1, height: 1 }],
    ['an APNG', 'png', undefined, { width: 40, height: 20 }],
  ] as const)('%s is drawn once, still', async (_, type, path, size) => {
    vi.useFakeTimers();
    const frame = vi.fn<() => void>();
    vi.stubGlobal('requestAnimationFrame', frame);
    try {
      const bytes = path ? Uint8Array.from(readFileSync(`${IMAGES}${path}`)) : apng();
      const { canvas, queue } = shown(type, bytes, size);
      place(canvas, true);
      nth(0).resolve(decoded(size.width, size));
      await settle(queue);
      await vi.advanceTimersByTimeAsync(10_000);
      place(canvas, true);
      expect(asked).toHaveLength(1);
      expect(page.drawImage).toHaveBeenCalledOnce();
      expect(frame).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('far off the screen, gives its pixels back, and near it again, is decoded again', async () => {
    const { canvas, queue } = shown('png', png(1), { width: 40, height: 20 });
    place(canvas, true);
    nth(0).resolve(decoded(40, { width: 40, height: 20 }));
    await settle(queue);
    expect([canvas.width, canvas.height]).toEqual([40, 20]);
    // Off the screen, but not far: it keeps them.
    place(canvas, false, true);
    expect([canvas.width, canvas.height]).toEqual([40, 20]);
    place(canvas, false, false);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    place(canvas, true);
    expect(asked).toHaveLength(2);
    nth(1).resolve(decoded(40, { width: 40, height: 20 }));
    await settle(queue);
    expect([canvas.width, canvas.height]).toEqual([40, 20]);
  });

  test('is decoded again when its box changes width, and only then', async () => {
    let width = 40;
    const { canvas, queue } = shown('png', png(1), { width: 400, height: 200 });
    box(canvas, () => width);
    place(canvas, true);
    nth(0).resolve(decoded(40, { width: 400, height: 200 }));
    await settle(queue);
    resize(canvas);
    expect(asked).toHaveLength(1);
    width = 80;
    resize(canvas);
    expect(nth(1).options.resizeWidth).toBe(80);
  });

  test('stopped while it decodes, draws nothing, and closes its bitmap', async () => {
    const { canvas, stop, failed, queue } = shown('png', png(1), { width: 40, height: 20 });
    place(canvas, true);
    stop();
    const made = decoded(40, { width: 40, height: 20 });
    nth(0).resolve(made);
    await settle(queue);
    expect(page.drawImage).not.toHaveBeenCalled();
    expect(made.close).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    expect(FakeIntersectionObserver.all).toHaveLength(0);
    expect(FakeResizeObserver.all).toHaveLength(0);
  });

  test('moved away while it decodes, draws nothing until it comes back', async () => {
    const { canvas, queue } = shown('png', png(1), { width: 40, height: 20 });
    place(canvas, true);
    place(canvas, false);
    nth(0).resolve(decoded(40, { width: 40, height: 20 }));
    await settle(queue);
    expect(page.drawImage).not.toHaveBeenCalled();
    place(canvas, true);
    expect(asked).toHaveLength(2);
  });
});

describe('decodes', () => {
  test('run one at a time across figures, in turn, and one that leaves first is skipped', async () => {
    const queue = new Decodes();
    const failed = vi.fn<(why: DrawFailure) => void>();
    const canvases = [canvasOf(40), canvasOf(40), canvasOf(40)];
    for (const canvas of canvases) {
      showImage({
        canvas,
        type: 'png',
        bytes: png(1),
        size: { width: 40, height: 20 },
        root: undefined,
        failed,
        queue,
      });
      place(canvas, true);
    }
    expect(asked).toHaveLength(1);
    expect(queue.waiting).toBe(2);
    // The second leaves before its turn.
    place(canvases[1]!, false);
    expect(queue.waiting).toBe(1);
    nth(0).resolve(decoded(40, { width: 40, height: 20 }));
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    nth(1).resolve(decoded(40, { width: 40, height: 20 }));
    await settle(queue);
    expect(canvases.map((canvas) => canvas.width)).toEqual([40, 0, 40]);
    expect(failed).not.toHaveBeenCalled();
  });
});
