// The name a commit gives its author, wherever it's drawn: an overview's byline, a term's. A login
// GitHub matched is drawn as a login; this name, which anyone can write, is drawn quoted, plain and
// cut to one short line, so no name can pass for a login or for Lo's words around it.

import { withoutBidi } from './controls.ts';

/** The most of a commit's name drawn, in characters as people count them: past it, it's cut. */
export const COMMIT_NAME_SHOWN = 24;

/**
 * Quotation marks, straight and curly, what passes for them, and the dots that set a byline's parts
 * apart. An apostrophe between letters, as in O'Brien, isn't one.
 */
const MARKS = /["“”„‟«»‹›〝〞〟＂″‶ʺ˝״·•‧∙⋅・･ᐧ⸱⸳ꞏ]|(?<!\p{L})['‘’‚‛＇]|['‘’‚‛＇](?!\p{L})/gu;

/**
 * The name a commit gives its author, without what could close Lo's quotes around it early or pass
 * for a byline's own separators, on one line. Empty when nothing's left of it.
 */
export function plainName(name: string): string {
  return name.replaceAll(MARKS, ' ').replaceAll(/\s+/g, ' ').trim();
}

/** The characters of `text`, as people count them. */
const characters = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * The name a commit gives its author: plain, quoted in curly quotes, on one line, and cut short to
 * {@link COMMIT_NAME_SHOWN} characters with an ellipsis: “Ravi K”.
 */
export function CommitName({ name }: { name: string }) {
  const plain = plainName(withoutBidi(name));
  const each = [...characters.segment(plain)].map((part) => part.segment);
  const drawn =
    each.length > COMMIT_NAME_SHOWN
      ? `${each
          .slice(0, COMMIT_NAME_SHOWN - 1)
          .join('')
          .trimEnd()}…`
      : plain;
  return (
    <span className="lo-ov-name" data-lo-commit-name>
      “<span className="lo-ov-name__text">{drawn}</span>”
    </span>
  );
}
