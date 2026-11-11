// The dialog of ready-made rules for the link routers, to copy.

import { Button, Callout, Dialog, DialogSpacer, Key } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { copyRule, openDocs } from './actions.ts';
import { routers } from './routers.ts';
import { welcomeStore } from './store.ts';

function close(): void {
  welcomeStore.setState({ rules: false });
}

/** The dialog, open while the screen's "Set up" for sending links to Lo is. */
export function Rules() {
  const open = useStore(welcomeStore, (state) => state.rules);
  const done = useRef<HTMLButtonElement>(null);
  const { system } = registry();
  /** The router whose rule was last copied, or whose copy failed. */
  const [copied, setCopied] = useState<{ name: string; ok: boolean }>();
  useEffect(() => {
    if (!open) setCopied(undefined);
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => welcomeStore.setState({ rules: next })}
      title="Send PR links to Lo"
      description="A link router hands the links you click to the app that should open them. Copy the rule for yours, and your browser stays the default."
      initialFocus={done}
      container={document.getElementById('root')}
      testId="link-rules"
      foot={
        <>
          <Button variant="ghost" onClick={() => void openDocs()}>
            Read the docs
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
      {copied?.ok === false && (
        <Callout tone="danger" role="alert">
          Lo couldn’t copy the rule for {copied.name}.
        </Callout>
      )}
      <span role="status" className="sr-only">
        {copied?.ok ? `Copied the rule for ${copied.name}.` : ''}
      </span>
      {routers.map((router) => (
        <section key={router.name} aria-label={router.name} className="flex flex-col gap-6">
          <div className="flex items-center gap-8">
            <h3 className="m-0 flex-1 text-ui-strong">{router.name}</h3>
            <Button
              size="sm"
              aria-label={`Copy the rule for ${router.name}`}
              onClick={() => {
                void copyRule(router.name, router.rule).then((ok) =>
                  setCopied({ name: router.name, ok }),
                );
              }}
            >
              {copied?.ok && copied.name === router.name ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="m-0 text-fg-muted text-small">{router.steps}</p>
          <pre className="m-0 overflow-auto rounded-sm bg-bg-well px-12 py-8 text-fg code-small no-ligatures">
            {router.rule}
          </pre>
        </section>
      ))}
    </Dialog>
  );
}
