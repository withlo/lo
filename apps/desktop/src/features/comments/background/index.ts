// The comments' jobs: a post's text as Lo's tree, comments' openings as plain text, and a file to
// attach. Pure work on what the window sends: GitHub's rendering through `githubTree`, which reads
// it as untrusted and falls back to the Markdown, or the Markdown itself, with the pull request's
// repository as what its references refer to; a comment's Markdown as one line of its words
// (`plainText`); and a file checked as GitHub takes it, with its metadata taken out
// (`prepareAttachment`).

import {
  attachmentKind,
  formatSize,
  needsPaidPlan,
  prepareAttachment,
  RefusedAttachment,
  uploadLimit,
} from '@lo/github';
import { githubTree, markdownTree, plainText, type Tree } from '@lo/markdown';

import { defineRunner } from '../../../background/runners.ts';
import {
  contract,
  EXCERPT,
  type PrepareInput,
  type Prepared,
  type RenderInput,
  type Rendered,
} from '../jobs.ts';

export default defineRunner(contract, {
  render: { run: (input) => renderPost(input) },
  excerpts: { run: ({ bodies }) => bodies.map(excerptFrom) },
  // A large video's boxes take a while to read through.
  prepare: { run: (input) => prepareFile(input), limits: { deadline: 30_000 } },
});

/**
 * A file to attach, as `comments.prepare` makes it: checked, with its metadata taken out, in bytes
 * of their own, or why Lo won't attach it.
 */
export function prepareFile({ name, bytes }: PrepareInput): Prepared {
  try {
    if (bytes === null) {
      // Larger than GitHub takes of anything, so not read.
      const kind = attachmentKind(name);
      if (kind === undefined) throw new RefusedAttachment({ reason: 'unsupported' });
      throw new RefusedAttachment({ reason: 'tooLarge', limit: uploadLimit(kind) });
    }
    const file = prepareAttachment(name, bytes);
    const { buffer, byteOffset, byteLength } = file.bytes;
    // What's sent on is memory of its own, never a view into a larger buffer.
    const own =
      buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength
        ? new Uint8Array(buffer)
        : file.bytes.slice();
    return {
      kind: 'prepared',
      name: file.name,
      bytes: own,
      size: formatSize(file.bytes.length),
      metadata: file.metadata,
      paidPlan: needsPaidPlan(file),
    };
  } catch (error) {
    if (error instanceof RefusedAttachment) return { kind: 'refused', why: error.message };
    throw error;
  }
}

/**
 * A comment's opening as one line of plain text, as `comments.excerpts` makes it: its words, none
 * of its Markdown's syntax or raw HTML's tags, and a long one cut short with an ellipsis. All of
 * it is read before it's cut, so no half of a link or an image is left in it.
 */
export function excerptFrom(markdown: string): string {
  const text = plainText(markdownTree(markdown, { html: 'words' }));
  if (text.length <= EXCERPT) return text;
  let end = EXCERPT - 1;
  // Never half of a character a surrogate pair makes.
  if (/[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

/** A post as Lo's tree, as `comments.render` makes it. */
export function renderPost({ html, markdown, repo, page }: RenderInput): Rendered {
  const tree =
    html === null
      ? markdownTree(markdown, { repo, page })
      : githubTree({ html, markdown }, { repo, page });
  return { tree, images: holdsImage(tree) };
}

/** Whether `tree` shows an image anywhere: the tree is plain data, as deep as its depth limit. */
function holdsImage(tree: Tree): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (typeof value !== 'object' || value === null) return false;
    if (Reflect.get(value, 'kind') === 'image') return true;
    return Object.values(value).some(visit);
  };
  return visit(tree.blocks);
}
