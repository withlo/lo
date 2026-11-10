/**
 * Reading git's `-z` output: records that end in a NUL, as bytes, since a path in one may not be
 * UTF-8.
 */

/** The NUL that ends each record of git's `-z` output. */
export const NUL = 0;

/** Splits `output` into records, each without its separator. A last record with none after it is kept. */
export function splitRecords(output: Uint8Array, separator = NUL): Buffer[] {
  const records: Buffer[] = [];
  const bytes = Buffer.from(output.buffer, output.byteOffset, output.byteLength);
  let start = 0;
  for (;;) {
    const end = bytes.indexOf(separator, start);
    if (end === -1) break;
    records.push(bytes.subarray(start, end));
    start = end + 1;
  }
  if (start < bytes.length) records.push(bytes.subarray(start));
  return records;
}

/** {@link splitRecords}, as the output streams in: each record as soon as its separator does. */
export async function* streamRecords(
  chunks: AsyncIterable<Uint8Array>,
  separator = NUL,
): AsyncGenerator<Buffer> {
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of chunks) {
    const piece = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let bytes = pending.length === 0 ? piece : Buffer.concat([pending, piece]);
    let start = 0;
    for (;;) {
      const end = bytes.indexOf(separator, start);
      if (end === -1) break;
      yield bytes.subarray(start, end);
      start = end + 1;
    }
    bytes = bytes.subarray(start);
    // A copy, so a long output's records don't keep every chunk they came in alive.
    pending = Buffer.from(bytes);
  }
  if (pending.length > 0) yield pending;
}
