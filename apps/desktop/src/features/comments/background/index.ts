// The comments' job: a post's text as Lo's tree. Pure work on what the window sends: GitHub's
// rendering through `githubTree`, which reads it as untrusted and falls back to the Markdown, or
// the Markdown itself, with the pull request's repository as what its references refer to.

import { githubTree, markdownTree, type Tree } from '@lo/markdown';

import { defineRunner } from '../../../background/runners.ts';
import { contract, type RenderInput, type Rendered } from '../jobs.ts';

export default defineRunner(contract, {
  render: { run: (input) => renderPost(input) },
});

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
