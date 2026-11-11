/**
 * Lo's tree for text from anyone: a comment, a review, a description, an overview. It holds only
 * the kinds below, each with the fields its type lists, so a renderer that is a closed switch over
 * `kind` makes only Lo's own elements, whatever the text said. It's plain data (objects, arrays,
 * strings, numbers, booleans), so it survives `structuredClone` and crosses from the background
 * process to the window as is.
 *
 * What a renderer must do with it:
 *
 * - Set every attribute itself. Nothing in the tree is an attribute, a class or a style.
 * - Never use a name from the tree as an element's id. Anchors (`Heading.anchor`, `Footnote.name`,
 *   an `anchor` target) are names inside one document: scope them to it, so text can't clobber an
 *   id of Lo's own.
 * - Keep the newlines in a text's value as line breaks. Normal text has none; text that stands in
 *   for something Lo doesn't show (raw HTML, content nested too deep) keeps its lines.
 * - Open a `web` target only through main, which checks it again, and load an `Image` only
 *   through main's image handler, which checks its address against `imageSources` again.
 */

/** What an extension, such as the overview format, adds to the tree. */
export interface Extension {
  readonly block: { readonly kind: string };
  readonly inline: { readonly kind: string };
  readonly target: { readonly kind: string };
}

/** No extension: the tree of a comment, a review or a description. */
export interface Plain {
  readonly block: never;
  readonly inline: never;
  readonly target: never;
}

export interface Tree<X extends Extension = Plain> {
  blocks: Block<X>[];
  /** What the reader should be told about how the text is shown, each at most once. */
  notes: Note[];
  /** What was refused or changed, for a checker to report. At most `MAX_DIAGNOSTICS`. */
  diagnostics: Diagnostic[];
}

/**
 * - `cut`: the text was longer than the length limit, and only its start is shown.
 * - `deep`: some of it nested deeper than the depth limit, and shows as plain text.
 * - `nodes`: it held more than the node limit, and the rest shows as plain text.
 */
export type Note = 'cut' | 'deep' | 'nodes';

export interface Diagnostic {
  /**
   * - `html`: raw HTML, shown as its text (or, for an HTML comment, left out);
   * - `image`: an image from outside GitHub's image hosts, shown as a link or its alt text;
   * - `link`: a link that isn't a web page or an anchor in the document, shown as its text.
   */
  code: 'html' | 'image' | 'link';
  /** The line it's on, counting from 1, when the source has lines. */
  line?: number;
}

export type Block<X extends Extension = Plain> =
  | Paragraph<X>
  | Heading<X>
  | Quote<X>
  | Alert<X>
  | List<X>
  | Code
  | Table<X>
  | Rule
  | Details<X>
  | Suggestion
  | Footnotes<X>
  | X['block'];

export interface Paragraph<X extends Extension = Plain> {
  kind: 'paragraph';
  children: Inline<X>[];
}

export interface Heading<X extends Extension = Plain> {
  kind: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Its name in the document, as GitHub makes it from the text, unique in the document. */
  anchor: string;
  children: Inline<X>[];
}

export interface Quote<X extends Extension = Plain> {
  kind: 'quote';
  children: Block<X>[];
}

/** GitHub's alerts: a quote that starts `[!NOTE]`, `[!TIP]` and so on. */
export interface Alert<X extends Extension = Plain> {
  kind: 'alert';
  type: 'note' | 'tip' | 'important' | 'warning' | 'caution';
  children: Block<X>[];
}

export interface List<X extends Extension = Plain> {
  kind: 'list';
  ordered: boolean;
  /** The first item's number: 1 for a bullet list. */
  start: number;
  /** Whether its items' paragraphs sit tight, without space between them. */
  tight: boolean;
  items: ListItem<X>[];
}

export interface ListItem<X extends Extension = Plain> {
  /** Set only on a task list's items: whether it's ticked. */
  checked?: boolean;
  children: Block<X>[];
}

export interface Code {
  kind: 'code';
  /** The language the writer named, when it's a plain name. Lo highlights it, or not. */
  language?: string;
  text: string;
}

export interface Table<X extends Extension = Plain> {
  kind: 'table';
  /** Each column's alignment. */
  align: ('left' | 'center' | 'right' | 'none')[];
  /** The header row's cells. */
  head: Inline<X>[][];
  /** The other rows, each a list of cells. */
  rows: Inline<X>[][][];
}

export interface Rule {
  kind: 'rule';
}

export interface Details<X extends Extension = Plain> {
  kind: 'details';
  open: boolean;
  summary: Inline<X>[];
  children: Block<X>[];
}

/** A review comment's suggested change: the lines it suggests. */
export interface Suggestion {
  kind: 'suggestion';
  text: string;
}

/** The footnotes, at the end of the document, in the order they're first referenced. */
export interface Footnotes<X extends Extension = Plain> {
  kind: 'footnotes';
  items: Footnote<X>[];
}

export interface Footnote<X extends Extension = Plain> {
  /** Its name in the document, which its references name. */
  name: string;
  /** The number its references show, from 1. */
  number: number;
  children: Block<X>[];
}

export type Inline<X extends Extension = Plain> =
  | Text
  | Strong<X>
  | Emphasis<X>
  | Strike<X>
  | InlineCode
  | Link<X>
  | Image
  | Break
  | Sub<X>
  | Sup<X>
  | Kbd<X>
  | Mention
  | FootnoteReference
  | X['inline'];

export interface Text {
  kind: 'text';
  value: string;
}

export interface Strong<X extends Extension = Plain> {
  kind: 'strong';
  children: Inline<X>[];
}

export interface Emphasis<X extends Extension = Plain> {
  kind: 'emphasis';
  children: Inline<X>[];
}

export interface Strike<X extends Extension = Plain> {
  kind: 'strike';
  children: Inline<X>[];
}

export interface InlineCode {
  kind: 'inlineCode';
  value: string;
}

export interface Link<X extends Extension = Plain> {
  kind: 'link';
  target: Target<X>;
  children: Inline<X>[];
}

/**
 * Where a link goes: a web page, as `URL` normalized it (`http:` or `https:`, with a host and no
 * user name or password), or a name in the same document.
 */
export type Target<X extends Extension = Plain> =
  { kind: 'web'; url: string } | { kind: 'anchor'; name: string } | X['target'];

/** An image on one of GitHub's image hosts (`imageSources`). */
export interface Image {
  kind: 'image';
  url: string;
  alt: string;
}

export interface Break {
  kind: 'break';
}

export interface Sub<X extends Extension = Plain> {
  kind: 'sub';
  children: Inline<X>[];
}

export interface Sup<X extends Extension = Plain> {
  kind: 'sup';
  children: Inline<X>[];
}

export interface Kbd<X extends Extension = Plain> {
  kind: 'kbd';
  children: Inline<X>[];
}

/** `@login` or `@org/team`, and its page on GitHub. */
export interface Mention {
  kind: 'mention';
  name: string;
  url: string;
}

export interface FootnoteReference {
  kind: 'footnoteReference';
  /** The footnote's name. */
  name: string;
  number: number;
}
