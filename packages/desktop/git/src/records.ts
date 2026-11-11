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

/**
 * {@link splitRecords}, as the output streams in: each record as soon as its separator does. Each
 * chunk is scanned once, and a record that spans chunks is joined once, when it ends, so the time
 * it takes grows with the output's length alone.
 */
export async function* streamRecords(
  chunks: AsyncIterable<Uint8Array>,
  separator = NUL,
): AsyncGenerator<Buffer> {
  // The start of the record being read, from the chunks before this one.
  let pending: Buffer[] = [];
  for await (const chunk of chunks) {
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let start = 0;
    for (;;) {
      const end = bytes.indexOf(separator, start);
      if (end === -1) break;
      const piece = bytes.subarray(start, end);
      yield pending.length === 0 ? piece : Buffer.concat([...pending, piece]);
      pending = [];
      start = end + 1;
    }
    if (start < bytes.length) pending.push(bytes.subarray(start));
  }
  if (pending.length > 0) yield Buffer.concat(pending);
}
