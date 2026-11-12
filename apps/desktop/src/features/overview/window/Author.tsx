// Who wrote an overview, as the byline and the reports draw it. A login GitHub matched to the
// commit is drawn as a login; the name a commit gives its author, which anyone can write, is drawn
// after Lo's own words, quoted, plain and clipped to one short line, so no name can pass for the
// rest of the byline.

import { Avatar } from '@lo/ui';
import type { ReactNode } from 'react';

import { withoutBidi } from '../../tab/window/shared.ts';
import type { OverviewCommit } from '../contract.ts';
import { ago, authorOf, shortId, type Author } from './says.ts';

/** The most of a commit's name drawn, in characters as people count them: past it, it's cut. */
const NAME_LIMIT = 24;

/** The characters of `text`, as people count them. */
const characters = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** The name a commit gives its author: quoted, plain, on one line, cut short. */
export function CommitName({ name }: { name: string }) {
  const plain = withoutBidi(name);
  const each = [...characters.segment(plain)].map((part) => part.segment);
  const drawn =
    each.length > NAME_LIMIT
      ? `${each
          .slice(0, NAME_LIMIT - 1)
          .join('')
          .trimEnd()}…`
      : plain;
  return (
    <span className="lo-ov-name" data-lo-commit-name>
      “<span className="lo-ov-name__text">{drawn}</span>”
    </span>
  );
}

/** The byline's picture of who wrote it: their avatar for a login, else a plain figure. */
export function AuthorPicture({ author }: { author: Author }) {
  if (author.kind === 'login') return <Avatar login={author.login} size="sm" />;
  return (
    <svg className="lo-i lo-ov-byline__figure" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="5.75" r="2.75" />
      <path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
    </svg>
  );
}

/** Who wrote it and when, as the byline says it: "ravi-k wrote this overview 2 days ago". */
export function WhoWrote({ author, when }: { author: Author; when: string }): ReactNode {
  switch (author.kind) {
    case 'login':
      return (
        <>
          <strong>{author.login}</strong> wrote this overview {when}
        </>
      );
    case 'name':
      return (
        <>
          Written {when} by the commit author <CommitName name={author.name} />
        </>
      );
    case 'unknown':
      return <>Written {when}</>;
    default:
      author satisfies never;
      return null;
  }
}

/**
 * The commit an overview is at, and who wrote it when, for the reports: "a91c4e2, written 2 days
 * ago by ravi-k".
 */
export function WrittenBy({ commit, now }: { commit: OverviewCommit; now: number }) {
  const author = authorOf(commit.byline);
  const when = ago(commit.byline.at, now);
  return (
    <>
      <span className="code-text">{shortId(commit.id)}</span>, written {when}
      {author.kind === 'login' && (
        <>
          {' '}
          by <strong>{author.login}</strong>
        </>
      )}
      {author.kind === 'name' && (
        <>
          {' '}
          by the commit author <CommitName name={author.name} />
        </>
      )}
    </>
  );
}
