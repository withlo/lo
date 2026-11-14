// What a comment box outside the diff shows in its preview: its text as GitHub would render it, made
// by the background process, with the pull request's repository as what references refer to, for
// the submit dialog's summary.

import { Markdown, secureLink, type Followed } from '@lo/ui/markdown';
import { useEffect, useState, type ReactNode } from 'react';

import { postImage } from '../../../window/images.ts';
import { followLink } from '../../open/window/shared.ts';
import { MARKDOWN_LIMIT, type Rendered } from '../jobs.ts';
import { commentsJobs } from './main.ts';
import type { PostPull } from './Post.tsx';

export interface PreviewProps {
  /** The view of a pull request's tab the box is in, whose account loads its images. */
  readonly view: string;
  /** The text, in Markdown. */
  readonly text: string;
  /** The pull request it's on, which its references and relative links are read against. */
  readonly pull: PostPull;
}

/** Opens a link followed in the preview: an `https` page, through main. */
function follow(target: Followed): void {
  if (target.kind !== 'web') return;
  const url = secureLink(target.url);
  if (url !== undefined) void followLink(url);
}

export function Preview({ view, text, pull }: PreviewProps): ReactNode {
  const [rendered, setRendered] = useState<{ text: string; rendered: Rendered }>();
  const { owner, repo, number } = pull;
  useEffect(() => {
    const stop = new AbortController();
    const page = `https://github.com/${owner}/${repo}/pull/${number}`;
    commentsJobs()
      .render(
        { html: null, markdown: text.slice(0, MARKDOWN_LIMIT), repo: { owner, name: repo }, page },
        { signal: stop.signal },
      )
      .then((made: Rendered) => {
        if (!stop.signal.aborted) setRendered({ text, rendered: made });
      })
      .catch((error: unknown) => {
        if (!stop.signal.aborted) console.error("Lo couldn't draw a preview:", error);
      });
    return () => stop.abort();
  }, [text, owner, repo, number]);
  if (text.trim() === '') return <p className="px-12 py-8 text-fg-muted">Nothing to preview</p>;
  return (
    <div className="px-12 py-8">
      {rendered?.text === text ? (
        <Markdown
          tree={rendered.rendered.tree}
          onFollow={follow}
          images={(url) => postImage(view, url)}
          className="lo-prose read-comment"
        />
      ) : (
        <p className="whitespace-pre-wrap">{text}</p>
      )}
    </div>
  );
}
