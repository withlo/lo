// A file's review threads counted, as the file tree and a diff's file headers show them: a comment
// mark and their number, which stands out while any is unresolved, with what it says in words for
// its tooltip and for screen readers.

/** What a count of `total` threads, `unresolved` of them unresolved, says in words. */
export function threadWords(total: number, unresolved: number): string {
  if (unresolved === 0) return total === 1 ? '1 resolved thread' : `${total} resolved threads`;
  if (unresolved === total) {
    return unresolved === 1 ? '1 unresolved thread' : `${unresolved} unresolved threads`;
  }
  return `${unresolved} / ${total} threads unresolved`;
}
