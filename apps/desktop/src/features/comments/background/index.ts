// The comments' jobs: a post's text as Lo's tree, and a file to attach. Pure work on what the window
// sends: GitHub's rendering through `githubTree`, which reads it as untrusted and falls back to the
// Markdown, or the Markdown itself, with the pull request's repository as what its references refer
// to; and a file checked as GitHub takes it, with its metadata taken out (`prepareAttachment`).

import {
  attachmentKind,
  formatSize,
  needsPaidPlan,
  prepareAttachment,
  RefusedAttachment,
  uploadLimit,
} from '@lo/github';
import { githubTree, markdownTree, type Tree } from '@lo/markdown';

import { defineRunner } from '../../../background/runners.ts';
import {
  contract,
  type PrepareInput,
  type Prepared,
  type RenderInput,
  type Rendered,
} from '../jobs.ts';

export default defineRunner(contract, {
  render: { run: (input) => renderPost(input) },
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
    const whole =
      file.bytes.byteOffset === 0 && file.bytes.byteLength === file.bytes.buffer.byteLength;
    return {
      kind: 'prepared',
      name: file.name,
      // What's sent on is its own memory, never a view into a larger buffer.
      bytes: whole ? file.bytes : file.bytes.slice(),
      size: formatSize(file.bytes.length),
      metadata: file.metadata,
      paidPlan: needsPaidPlan(file),
    };
  } catch (error) {
    if (error instanceof RefusedAttachment) return { kind: 'refused', why: error.message };
    throw error;
  }
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
