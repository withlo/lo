// The welcome's last step: how a review starts. A field for a pull request's link, with the link
// on the clipboard a button away, and a sample pull request to open. The mark kisses as the step
// shows: the set-up is done.

import { Button, Collapse, Input, LogoMotion, Mark, SetupItem, SetupList } from '@lo/ui';
import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { client } from '../../../window/ipc.ts';
import { contract as open } from '../../open/contract.ts';
import { NOT_OPENED, openPublic } from './actions.ts';

/** A merged pull request of Lo's own, which is public and stays up, with an overview to read. */
export const SAMPLE = {
  link: 'https://github.com/withlo/lo/pull/182',
  title: 'Go to the other end of moved code',
  where: 'withlo/lo #182',
} as const;

function PullIcon() {
  return (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4.5" cy="4" r="1.75" />
      <circle cx="4.5" cy="12" r="1.75" />
      <circle cx="11.5" cy="12" r="1.75" />
      <path d="M4.5 5.75v4.5M11.5 10.25V7a2 2 0 0 0-2-2H8M9.5 3.5 8 5l1.5 1.5" />
    </svg>
  );
}

type Busy = 'field' | 'paste' | 'sample' | undefined;

export function OpenStep({ shown }: { shown: boolean }): ReactNode {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<Busy>();
  const [problem, setProblem] = useState<string>();
  const why = useId();

  /** Opens `link` for `from`, and says under the field why it didn't. */
  const openFrom = (from: NonNullable<Busy>, link: string) => {
    setBusy(from);
    setProblem(undefined);
    openPublic(link).then(
      (refused) => {
        setBusy(undefined);
        setProblem(refused);
        if (refused === undefined) setText('');
      },
      (error: unknown) => {
        console.error("Lo couldn't open the link:", error);
        setBusy(undefined);
        setProblem(NOT_OPENED);
      },
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy !== undefined || text.trim() === '') return;
    openFrom('field', text);
  };

  /** Takes the pull request link on the clipboard, if there's one, and opens it. */
  const paste = () => {
    if (busy !== undefined) return;
    setBusy('paste');
    setProblem(undefined);
    client(open)
      .clipboard()
      .then(
        (link) => {
          if (link === null) {
            setBusy(undefined);
            setProblem('No pull request link on the clipboard');
            return;
          }
          setText(link);
          openFrom('paste', link);
        },
        (error: unknown) => {
          console.error("Lo couldn't read the clipboard:", error);
          setBusy(undefined);
          setProblem(NOT_OPENED);
        },
      );
  };

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-12">
          {/* The kiss plays each time the step shows, and never while it's only holding room. */}
          {shown ? (
            <LogoMotion play="kiss" className="size-40 flex-none" decorative />
          ) : (
            <Mark className="size-40 flex-none" />
          )}
          <h1 className="m-0 text-heading">Open a pull request</h1>
        </div>
        <p className="m-0 text-fg-muted text-ui">Paste a link from GitHub, or open a sample.</p>
      </div>
      <form className="flex flex-col gap-6" onSubmit={submit}>
        <div className="flex gap-8">
          <Input
            mono
            data-welcome-focus
            aria-label="Pull request link"
            aria-describedby={problem === undefined ? undefined : why}
            placeholder="https://github.com/owner/repo/pull/123"
            value={text}
            invalid={problem !== undefined}
            onChange={(event) => {
              setText(event.target.value);
              setProblem(undefined);
            }}
          />
          <Button busy={busy === 'paste'} onClick={paste}>
            Paste link
          </Button>
          <Button
            type="submit"
            busy={busy === 'field'}
            working="Opening…"
            disabled={busy === undefined && text.trim() === ''}
          >
            Open
          </Button>
        </div>
        <Collapse open={problem !== undefined}>
          {problem !== undefined && (
            <p id={why} role="alert" className="m-0 text-danger text-small">
              {problem}
            </p>
          )}
        </Collapse>
      </form>
      <SetupList label="Sample pull request">
        <SetupItem icon={<PullIcon />} title={SAMPLE.title} description={SAMPLE.where}>
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
