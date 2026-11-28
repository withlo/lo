// Who a term's definition is by, wherever the term is drawn: its card, its row, a suggestion and an
// earlier definition in its row. One line of small text after a 16 px avatar, in `lo-fg-muted`:
// the account, whether a coding agent's overview wrote it or a person in Lo, the pull request it
// came from, and when. "ravi-k · agent-written · #264 · 3 d ago".

import { Avatar } from '../Avatar.tsx';
import { Swap } from '../Collapse.tsx';
import { CommitName, plainName } from '../CommitName.tsx';
import { withoutBidi } from '../controls.ts';
import { Icon } from '../Icon.tsx';
import { LinkButton } from '../LinkButton.tsx';
import { Skeleton } from '../Spinner.tsx';

/**
 * Who wrote a definition: the GitHub account, by its login, with its picture's address where
 * there is one; or, for an agent's change whose commit GitHub matched to no account, the name the
 * commit gives, which anyone can write, and so is marked "not verified".
 */
export type TermWriter = { login: string; image?: string | undefined } | { name: string };

/** Who writes definitions: a coding agent, in an overview, or a person, editing in Lo. */
export type TermWritten = 'agent' | 'human';

/** A term's byline once the store is read. */
export interface TermBylineFacts {
  by: TermWriter;
  written: TermWritten;
  /**
   * The pull request whose overview it came from, "#264", a link that opens it. An edit in Lo
   * names none.
   */
  pull?: { number: number; onOpen?: (() => void) | undefined } | undefined;
  /** When, as Lo writes a time past: "3 d ago" (`ago`). */
  when: string;
}

/** What a byline says: who and how, or that the store is still being read. */
export type TermBylineShown =
  | ({ reading?: false | undefined } & TermBylineFacts)
  /** The store is still being read: a skeleton in the byline's place, which it then Swaps over. */
  | { reading: true };

export type TermBylineProps = TermBylineShown & {
  /**
   * `false` on a surface that takes no focus, as a term's card: its pull request's link is out of
   * the tab order, and a click on it leaves focus where it was.
   */
  focusable?: boolean | undefined;
};

/** What "agent-written" and "human-written" say, after `·`. */
const WRITTEN: Readonly<Record<TermWritten, string>> = {
  agent: 'agent-written',
  human: 'human-written',
};

/**
 * A term's byline: who, written how, from which pull request, and when, as one run of text that
 * wraps after the avatar. Until the store is read (`reading`), a skeleton 120 by 12 px holds its
 * place, and the byline fades in over it (Swap).
 */
export function TermByline(props: TermBylineProps) {
  const { focusable = true } = props;
  if (props.reading === true) {
    return (
      <Swap id="reading" className="flex h-16 items-center">
        <Skeleton className="h-12 term-byline-wait" />
      </Swap>
    );
  }
  const { by, written, pull, when } = props;
  const named = 'name' in by;
  return (
    <Swap id="byline" className="flex min-w-0 items-start gap-6 text-fg-muted text-small">
      {named ? (
        // A name GitHub matched to no account has no picture: a figure in the avatar's box.
        <span className="flex size-16 flex-none items-center justify-center text-icon-muted">
          <Icon name="user-round" size={12} />
        </span>
      ) : (
        <Avatar login={by.login} size="xs" image={by.image} />
      )}
      <span className="min-w-0">
        {named ? (
          // A name with nothing left once it's plain, such as "·", is no name: only that it's not
          // verified.
          plainName(withoutBidi(by.name)) === '' ? (
            'not verified'
          ) : (
            <>
              <CommitName name={by.name} /> · not verified
            </>
          )
        ) : (
          <span className="font-semibold text-fg">{withoutBidi(by.login)}</span>
        )}
        {` · ${WRITTEN[written]}`}
        {pull !== undefined && (
          <>
            {' · '}
            <span className="lo-num">
              <LinkButton onClick={pull.onOpen} focusable={focusable}>
                {`#${pull.number}`}
              </LinkButton>
            </span>
          </>
        )}
        {' · '}
        <span className="lo-num whitespace-nowrap">{when}</span>
      </span>
    </Swap>
  );
}
