// Images' headers for the overview feature's tests, built byte by byte: a JPEG's segments, with
// as much before the frame that gives its size as a test asks. Only the header is real: what
// follows it is never an image.

/** `parts`, one after another. */
export function join(...parts: (Uint8Array | readonly number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const u16 = (value: number) => [(value >>> 8) & 0xff, value & 0xff];

/** A JPEG segment: its marker, its length, and `data`. */
function segment(marker: number, data: readonly number[] | Uint8Array): Uint8Array {
  return join([0xff, marker, ...u16(data.length + 2)], data);
}

/**
 * A JPEG of `width` by `height`, its frame after `before` bytes of other segments, then `after`
 * bytes past its end.
 */
export function jpeg(width: number, height: number, { before = 0, after = 0 } = {}): Uint8Array {
  const app0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const others: Uint8Array[] = [];
  for (let left = before; left > 0; left -= 60_000) {
    others.push(segment(0xe1, new Uint8Array(Math.min(left, 60_000))));
  }
  const frame = segment(0xc0, [8, ...u16(height), ...u16(width), 1, 1, 0x11, 0]);
  return join(
    [0xff, 0xd8],
    app0,
    ...others,
    frame,
    [0xff, 0xda, 0, 2, 0xff, 0xd9],
    new Uint8Array(after),
  );
}
