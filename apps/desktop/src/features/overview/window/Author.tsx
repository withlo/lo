// Who wrote an overview, as its byline draws it. A login GitHub matched to the commit is drawn as a
// login; the name a commit gives its author, which anyone can write, is drawn quoted, plain and
// clipped to one short line, so no name can pass for the rest of the byline.

import { Avatar, Icon } from '@lo/ui';
import type { ReactNode } from 'react';

import { withoutBidi } from '../../tab/window/shared.ts';
import type { Author } from './says.ts';

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
  return <Icon name="user-round" size={16} className="lo-ov-byline__figure" />;
}

/** Who wrote it and when, as the byline says it: "ravi-k · 2 d ago". */
export function WhoWrote({ author, when }: { author: Author; when: string }): ReactNode {
  switch (author.kind) {
    case 'login':
      return (
        <>
          <strong>{author.login}</strong> · {when}
        </>
      );
    case 'name':
      return (
        <>
          <CommitName name={author.name} /> · {when}
        </>
      );
    case 'unknown':
      return <>{when}</>;
    default:
      author satisfies never;
      return null;
  }
}
