// The dialog of ready-made rules for the apps that open links, to copy.

import { Button, Collapse, CopyButton, Dialog, DialogSpacer, Key, useCopy } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { openDocs } from './actions.ts';
import { routers } from './routers.ts';
import { welcomeStore } from './store.ts';
import { Ticks } from './Ticks.tsx';

function close(): void {
  welcomeStore.setState({ rules: false });
}

/** The dialog, open while "Show rules" on the welcome's set-up step is. */
export function Rules() {
  const open = useStore(welcomeStore, (state) => state.rules);
  const done = useRef<HTMLButtonElement>(null);
  const copy = useCopy();
  const { system } = registry();
  /** Whether the documentation didn't open, which the line by its button says. */
  const [unopened, setUnopened] = useState(false);
  useEffect(() => {
    if (!open) setUnopened(false);
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => welcomeStore.setState({ rules: next })}
      title="Send pull request links to Lo"
      description="Copy the rule for the app that opens your links."
      initialFocus={done}
      container={document.getElementById('root')}
      testId="link-rules"
      foot={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setUnopened(false);
              void openDocs().then((opened) => setUnopened(!opened));
            }}
          >
            Open documentation
          </Button>
          <Collapse open={unopened}>
            <span role="alert" className="text-danger text-small">
              Couldn’t open the documentation
            </span>
          </Collapse>
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
      {routers.map((router) => (
        <section key={router.name} aria-label={router.name} className="flex flex-col gap-6">
          <h3 className="m-0 text-ui-strong">{router.name}</h3>
          {router.steps.length === 1 ? (
            <p className="m-0 text-fg-muted text-small">
              <Ticks text={router.steps[0] ?? ''} />
            </p>
          ) : (
            <ol className="m-0 flex list-decimal flex-col gap-2 ps-16 text-fg-muted text-small">
              {router.steps.map((step) => (
                <li key={step}>
                  <Ticks text={step} />
                </li>
              ))}
            </ol>
          )}
          <div className="flex items-start gap-8 rounded-sm bg-bg-well p-8">
            <pre className="m-0 min-w-0 flex-1 overflow-auto text-fg code-small">{router.rule}</pre>
            <CopyButton size="sm" onCopy={() => copy(router.rule)} />
          </div>
        </section>
      ))}
    </Dialog>
  );
}
