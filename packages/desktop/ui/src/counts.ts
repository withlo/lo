// A file's review threads counted, as the file tree and a diff's file headers show them: a comment
// mark and their number, which stands out while any is unresolved, with what it says in words for
// its tooltip and for screen readers.

/** A speech bubble on the 16 grid, the mark of a comment: its outline. */
export const COMMENT_PATH =
  'M2.75 3.25c0-.55.45-1 1-1h8.5c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H7.5L4.75 13v-2.25h-1c-.55 0-1-.45-1-1Z';

/** What a count of `total` threads, `unresolved` of them unresolved, says in words. */
export function threadWords(total: number, unresolved: number): string {
  if (unresolved === 0)
    return total === 1 ? '1 thread, resolved' : `${total} threads, all resolved`;
  if (unresolved === total) return `${unresolved} unresolved`;
  return `${unresolved} unresolved of ${total}`;
}
