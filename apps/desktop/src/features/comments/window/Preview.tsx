// What a comment box shows in its preview, in the diff and outside it, as the submit dialog's
// summary: its text as GitHub would render it, made by the background process, with the pull
// request's repository as what references refer to.

import { EmptyState } from '@lo/ui';
import { Markdown, secureLink, type Followed } from '@lo/ui/markdown';
import { useEffect, useState, type ReactNode } from 'react';

import { postImage } from '../../../window/images.ts';
import { followLink } from '../../open/window/shared.ts';
import type { Rendered } from '../jobs.ts';
import type { PostPull } from './Post.tsx';
import { drawWritten, treeOf, writtenDrawn } from './store.ts';

export interface PreviewProps {
  /** The view of a pull request's tab the box is in, whose account loads its images. */
  readonly view: string;
  /** The text, in Markdown. */
  readonly text: string;
  /** The pull request it's on, which its references and relative links are read against. */
  readonly pull: PostPull;
  /** With no padding of its own, as inside a card. */
  readonly flush?: boolean | undefined;
  /** The lines a suggested change in it replaces, as the diff shows them, where known. */
  readonly replaced?: string | undefined;
  /**
   * It's the text as sent or saved, which the comment's card from GitHub then draws from the tree
   * made here, from its first frame: it's kept, and one kept before is drawn at once.
   */
  readonly sent?: boolean | undefined;
}

/** Opens a link followed in the preview: an `https` page, through main. */
function follow(target: Followed): void {
  if (target.kind !== 'web') return;
  const url = secureLink(target.url);
  if (url !== undefined) void followLink(url);
}

export function Preview({
  view,
  text,
  pull,
  flush = false,
  replaced,
  sent = false,
}: PreviewProps): ReactNode {
  const [rendered, setRendered] = useState<{ text: string; rendered: Rendered } | undefined>(() => {
    const kept = sent ? writtenDrawn(view, text) : undefined;
    return kept && { text, rendered: kept.rendered };
  });
  const { owner, repo, number } = pull;
  useEffect(() => {
    const stop = new AbortController();
    const at = { owner, repo, number };
    // As sent, its tree is the one kept for its card from GitHub, made unless it was as it went.
    const made = sent
      ? drawWritten(view, text, at).then(() => writtenDrawn(view, text)?.rendered)
      : treeOf(text, at, stop.signal);
    made
      .then((tree) => {
        if (stop.signal.aborted || !tree) return;
        setRendered((was) =>
          was?.text === text && was.rendered === tree ? was : { text, rendered: tree },
        );
      })
      .catch((error: unknown) => {
        if (!stop.signal.aborted) console.error("Lo couldn't draw a preview:", error);
      });
    return () => stop.abort();
  }, [view, text, sent, owner, repo, number]);
  if (text.trim() === '') {
    return (
      <div className="px-12 py-8">
        <EmptyState fit="row" icon="eye" title="Nothing to preview" />
      </div>
    );
  }
  return (
    <div className={flush ? undefined : 'px-12 py-8'}>
      {rendered?.text === text ? (
        <Markdown
          tree={rendered.rendered.tree}
          onFollow={follow}
          images={(url) => postImage(view, url)}
          replaced={replaced}
          className="lo-prose lo-prose--comment read-comment"
        />
      ) : (
        <p className="whitespace-pre-wrap">{text}</p>
      )}
    </div>
  );
}
