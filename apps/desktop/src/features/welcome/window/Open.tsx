// The welcome's last step: how a review starts. A field for a pull request's link, with the link
// on the clipboard a button away, and a sample pull request to open. The mark kisses as the step
// first shows: the set-up is done.

import {
  Button,
  Collapse,
  Input,
  Key,
  LogoMotion,
  Mark,
  Problem,
  SetupItem,
  SetupList,
  Ticks,
} from '@lo/ui';
import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';

import { refuse } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract as open, type NotPull } from '../../open/contract.ts';
import { isNotPull, NotPullNote, notPullWords } from '../../open/window/shared.ts';
import { overviews } from '../../overview/window/shared.ts';
import { openPublic } from './actions.ts';
import { StepHeading } from './Heading.tsx';
import { keyOf } from './labels.ts';
import { usePlayOnce } from './played.ts';
import { welcomeStore } from './store.ts';

/** A merged pull request of Lo's own, which is public and stays up, with an overview to read. */
export const SAMPLE = {
  link: 'https://github.com/withlo/lo/pull/182',
  title: 'Go to the other end of moved code',
  where: 'withlo/lo#182',
} as const;

type Busy = 'field' | 'paste' | 'sample' | undefined;

/**
 * What went wrong opening a link, said under the field: text that isn't a pull request link, as
 * the open box says it, or a link that didn't open.
 */
type Failure =
  | { readonly kind: 'notPull'; readonly why: NotPull }
  | {
      readonly kind: 'failed';
      readonly title: string;
      /** Main's reason, where it gave one: a sentence, with code between backticks. */
      readonly reason?: string | undefined;
      /** What came back, as it came. */
      readonly details?: string | undefined;
    };

const NOT_OPENED = 'Couldn’t open the link';

/** An error's own words, for Details. */
function wordsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function OpenStep({ shown }: { shown: boolean }): ReactNode {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<Busy>();
  const [failure, setFailure] = useState<Failure>();
  const why = useId();
  const kiss = usePlayOnce('kiss', shown);
  const typed = text.trim() !== '';
  // It has one to read only while there are overviews: off, it opens on its timeline.
  const withOverview = useSyncExternalStore(overviews.subscribe, overviews.now);
  const key = keyOf('welcome.continue');

  // With a link in the field, Open is the step's main button, in the foot's place.
  useEffect(() => {
    if (!shown) return undefined;
    welcomeStore.setState({ linked: typed });
    return () => welcomeStore.setState({ linked: false });
  }, [shown, typed]);

  /** Opens `link` for `from`, and says under the field why it didn't. */
  const openFrom = (from: NonNullable<Busy>, link: string) => {
    setBusy(from);
    setFailure(undefined);
    openPublic(link).then(
      (refused) => {
        setBusy(undefined);
        if (refused === undefined) setText('');
        else if (refused.why !== undefined && isNotPull(refused.why)) {
          setFailure({ kind: 'notPull', why: refused.why });
        } else {
          const reason = refused.message === '' ? undefined : refused.message;
          setFailure({ kind: 'failed', title: NOT_OPENED, reason });
        }
      },
      (error: unknown) => {
        console.error("Lo couldn't open the link:", error);
        setBusy(undefined);
        setFailure({ kind: 'failed', title: NOT_OPENED, details: wordsOf(error) });
      },
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy !== undefined || !typed) return;
    openFrom('field', text);
  };

  /** Takes the pull request link on the clipboard, if there's one, and opens it. */
  const paste = () => {
    if (busy !== undefined) return;
    setBusy('paste');
    setFailure(undefined);
    client(open)
      .clipboard()
      .then(
        (link) => {
          if (link === null) {
            setBusy(undefined);
            refuse('No pull request link on the clipboard');
            return;
          }
          setText(link);
          openFrom('paste', link);
        },
        (error: unknown) => {
          console.error("Lo couldn't read the clipboard:", error);
          setBusy(undefined);
          setFailure({
            kind: 'failed',
            title: 'Couldn’t read the clipboard',
            details: wordsOf(error),
          });
        },
      );
  };

  return (
    <>
      <StepHeading
        mark={
          // The kiss plays as the step first shows, and the mark rests after.
          kiss ? (
            <LogoMotion play="kiss" className="size-40 flex-none" decorative />
          ) : (
            <span className="flex flex-none" aria-hidden="true">
              <Mark className="size-40" />
            </span>
          )
        }
        title="Open a pull request"
        line="Paste a link from GitHub, or open a sample."
      />
      <form className="flex flex-col gap-8" onSubmit={submit}>
        <div className="flex gap-8">
          <Input
            mono
            data-welcome-focus
            aria-label="Pull request link"
            aria-describedby={failure === undefined ? undefined : why}
            placeholder="https://github.com/owner/repo/pull/123"
            value={text}
            invalid={failure?.kind === 'failed'}
            onChange={(event) => {
              setText(event.target.value);
              setFailure(undefined);
            }}
          />
          <Button busy={busy === 'paste'} onClick={paste}>
            Paste link
          </Button>
          <Button
            type="submit"
            variant={typed ? 'primary' : 'secondary'}
            {...(typed ? { 'data-welcome-default': true } : {})}
            busy={busy === 'field'}
            working="Opening…"
            disabled={busy === undefined && !typed}
          >
            Open
            {typed && key && <Key keys={key} decorative className="text-on-accent" />}
          </Button>
        </div>
        <Collapse open={failure !== undefined}>
          {failure?.kind === 'notPull' && <NotPullNote id={why} why={failure.why} />}
          {failure?.kind === 'failed' && (
            <div id={why}>
              <Problem
                title={failure.title}
                reason={failure.reason === undefined ? undefined : <Ticks text={failure.reason} />}
                details={failure.details}
              />
            </div>
          )}
        </Collapse>
        {/* There all along, so the note is read as it comes; the Problem is an alert of its own. */}
        <span role="status" className="sr-only">
          {failure?.kind === 'notPull' ? notPullWords(failure.why) : ''}
        </span>
      </form>
      <SetupList label="Sample pull request">
        <SetupItem
          icon="git-pull-request"
          title={SAMPLE.title}
          description={withOverview ? `${SAMPLE.where} · has an overview` : SAMPLE.where}
        >
          <Button
            size="sm"
            busy={busy === 'sample'}
            working="Opening…"
            onClick={() => {
              if (busy === undefined) openFrom('sample', SAMPLE.link);
            }}
          >
            Open
          </Button>
        </SetupItem>
      </SetupList>
    </>
  );
}
