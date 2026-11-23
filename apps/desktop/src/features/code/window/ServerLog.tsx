// The dialog that shows a language server's log: plain text, as main keeps it in memory, with a
// way to copy it.

import {
  Button,
  CopyFaces,
  CopyStatus,
  Dialog,
  DialogSpacer,
  Key,
  Problem,
  useCopySaid,
} from '@lo/ui';
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
  const [said, say] = useCopySaid();
  // Each "Try again" reads the log once more.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setLog(undefined);
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
  }, [shown, attempt]);
  const lines = log ? log.lines : [];
  return (
    <Dialog
      open={shown !== undefined}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={shown ? `${shown.name}’s log` : 'Language server log'}
      description="The last 1,000 lines."
      initialFocus={done}
      container={document.getElementById('root')}
      testId="server-log"
      foot={
        <>
          <Button
            variant="ghost"
            disabled={lines.length === 0}
            onClick={() => {
              void copyLog(lines).then((copied) => say(copied ? 'copied' : 'failed'));
            }}
          >
            <CopyFaces said={said}>Copy log</CopyFaces>
          </Button>
          <CopyStatus said={said} />
          <DialogSpacer />
          <Button ref={done} variant="primary" onClick={close}>
            Close
            <Key
              keys={keyLabels(systemStrokes(parseKeys('enter'), system), system)}
              decorative
              className="text-on-accent"
            />
          </Button>
        </>
      }
    >
      {log === false ? (
        <Problem
          layout="inline"
          title="Can’t show the log"
          action={{ label: 'Try again', onClick: () => setAttempt((count) => count + 1) }}
        />
      ) : log === undefined ? null : lines.length === 0 ? (
        <p className="m-0 text-fg-muted">No log lines yet</p>
      ) : (
        <pre className="m-0 overflow-auto rounded-sm bg-bg-well px-12 py-8 text-fg code-small">
          {lines.join('\n')}
        </pre>
      )}
    </Dialog>
  );
}
