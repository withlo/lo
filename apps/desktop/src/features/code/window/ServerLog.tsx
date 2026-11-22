// The dialog that shows a language server's log: plain text, as main keeps it in memory, with a
// way to copy it.

import { Button, Callout, Dialog, DialogSpacer, Key } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import type { ServerLog as Log } from '../contract.ts';
import { main } from './main.ts';
import { copyLog, logStore } from './servers.ts';

function close(): void {
  logStore.setState({ shown: undefined });
}

/** The dialog, open while a server's "Show the log" is. */
export function ServerLog() {
  const shown = useStore(logStore, (state) => state.shown);
  const done = useRef<HTMLButtonElement>(null);
  const { system } = registry();
  /** The log once main has said, `null` for none, or `false` when it couldn't be read. */
  const [log, setLog] = useState<Log | null | false | undefined>();
  const [copied, setCopied] = useState<boolean>();
  useEffect(() => {
    setLog(undefined);
    setCopied(undefined);
    if (!shown) return undefined;
    let current = true;
    main()
      .log({ view: shown.view, server: shown.server })
      .then((read) => {
        if (current) setLog(read);
      })
      .catch((error: unknown) => {
        console.error("Lo couldn't read a language server's log:", error);
        if (current) setLog(false);
      });
    return () => {
      current = false;
    };
  }, [shown]);
  const lines = log ? log.lines : [];
  return (
    <Dialog
      open={shown !== undefined}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={shown ? `${shown.name}'s log` : 'Log'}
      description="Its last 1,000 lines, kept in memory while Lo runs."
      initialFocus={done}
      container={document.getElementById('root')}
      testId="server-log"
      foot={
        <>
          <Button
            variant="ghost"
            disabled={lines.length === 0}
            onClick={() => {
              void copyLog(lines).then(setCopied);
            }}
          >
            {copied ? 'Copied' : 'Copy the log'}
          </Button>
          <DialogSpacer />
          <Button ref={done} variant="primary" onClick={close}>
            Done
            <Key
              keys={keyLabels(systemStrokes(parseKeys('enter'), system), system)}
              decorative
              className="text-on-accent"
            />
          </Button>
        </>
      }
    >
      {copied === false && (
        <Callout tone="danger" role="alert">
          Lo couldn’t copy the log.
        </Callout>
      )}
      <span role="status" className="sr-only">
        {copied ? 'Copied the log.' : ''}
      </span>
      {log === false ? (
        <Callout tone="danger">Lo couldn’t read the log.</Callout>
      ) : log === undefined ? null : lines.length === 0 ? (
        <p className="m-0 text-fg-muted">Nothing is in the log yet.</p>
      ) : (
        <pre className="m-0 overflow-auto rounded-sm bg-bg-well px-12 py-8 text-fg code-small">
          {lines.join('\n')}
        </pre>
      )}
    </Dialog>
  );
}
