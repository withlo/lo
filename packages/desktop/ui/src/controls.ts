// Text from a repository or a language server, set where it's read. Bidirectional controls are
// invisible and reorder the characters around them: a file named `evil`, U+202E, `slx.txt` reads as
// `eviltxt.xls`. Each is shown as the replacement character instead, one for one, so a reader sees
// that something is there, and where, and an offset into the text still points at the same place.

/** The bidirectional formatting characters: marks, embeddings, overrides and isolates. */
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

const SHOWN = '\uFFFD';

/** `text`, with each bidirectional control in it shown as the replacement character. */
export function showControls(text: string): string {
  return text.replace(BIDI, SHOWN);
}

/**
 * `value` with every string in it passed through {@link showControls}: a tree of objects and arrays,
 * such as `@lo/markdown`'s, which is JSON-shaped as it comes from main. It builds a new tree and
 * never changes the one it's given.
 */
export function showControlsIn<T>(value: T): T {
  const shown: T = JSON.parse(JSON.stringify(value), (_key, each: unknown) =>
    typeof each === 'string' ? showControls(each) : each,
  );
  return shown;
}
