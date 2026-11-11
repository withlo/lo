// The open box (`⌘L`): a link to a pull request, filled in from the clipboard when it holds one,
// with what it opens and as whom, or why it can't, and what `⏎` does about it.

import { Button, Palette, PaletteHint, Spinner, Tag } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import type { PullState } from '../../tab/contract.ts';
import type { Preview } from '../contract.ts';
import {
  addAccount,
  boxClosed,
  boxStore,
  closeBox,
  currentPreview,
  enterAction,
  openAs,
  openPage,
  openText,
  submit,
  typeText,
} from './box.ts';

/** A row of the box: the pull request, or one of the accounts that can open it. */
type Row = { kind: 'pull'; id: 'pull' } | { kind: 'as'; id: string; login: string };

/** A key written in Lo's notation, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** The first key `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

const STATE_WORDS: Readonly<Record<PullState, string>> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

const LINK_ICON = (
  <svg className="lo-i text-fg-muted" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6.5 9.5l3-3M7 4.5l1-1a2.47 2.47 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.47 2.47 0 0 1 4.5 9l1-1" />
  </svg>
);

const WARN_ICON = (
  <svg className="lo-i lo-i--sm mt-2 flex-none text-warning" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
    <path d="M8 6.25v3M8 11.25v.01" />
  </svg>
);

const LOCK_ICON = (
  <svg className="lo-i lo-i--sm mt-2 flex-none text-danger" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

/** A message under the input: an icon, what's so, and what to do about it. */
function Message({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <>
      {icon}
      <div className="flex min-w-0 flex-col gap-2">
        <span className="font-semibold">{title}</span>
        {children}
      </div>
    </>
  );
}

/** What the box says under the input, for what's in it, if anything. */
function messageFor(preview: Preview | undefined, text: string, opening: boolean): ReactNode {
  if (opening) {
    return <Message icon={<Spinner size="xs" />} title="Opening…" />;
  }
  if (preview === undefined) {
    return text.trim() === '' ? undefined : (
      <Message icon={<Spinner size="xs" />} title="Looking it up…" />
    );
  }
  switch (preview.kind) {
    case 'empty':
    case 'pull':
      return undefined;
    case 'invalid':
      return (
        <Message icon={WARN_ICON} title="That isn’t a link Lo opens">
          <span className="text-fg-muted text-small">{preview.message}</span>
        </Message>
      );
    case 'web':
      return (
        <Message icon={WARN_ICON} title={preview.title}>
          <span className="text-fg-muted text-small">{preview.message}</span>
        </Message>
      );
    case 'blocked':
      return (
        <Message icon={LOCK_ICON} title={preview.title}>
          <span className="text-fg-muted text-small">{preview.message}</span>
          {(preview.links.length > 0 || preview.signIn) && (
            <span className="mt-6 flex flex-wrap gap-8">
              {preview.links.map((link) => (
                <Button
                  key={link.url}
                  size="sm"
                  variant="primary"
                  onClick={() => void openPage(link.url)}
                >
                  {link.label}
                </Button>
              ))}
              {preview.signIn && (
                <Button
                  size="sm"
                  variant={preview.links.length > 0 ? 'ghost' : 'primary'}
                  onClick={addAccount}
                >
                  {preview.links.length > 0 ? 'Use another account' : 'Add an account'}
                </Button>
              )}
            </span>
          )}
        </Message>
      );
    default:
      preview satisfies never;
      return undefined;
  }
}

/** The rows for what's in the box: the pull request, or the accounts to choose from. */
function rowsFor(preview: Preview | undefined): Row[] {
  if (preview?.kind !== 'pull') return [];
  if (preview.as.kind === 'ask') {
    return preview.as.logins.map((login) => ({ kind: 'as', id: `as:${login}`, login }));
  }
  return [{ kind: 'pull', id: 'pull' }];
}

/** A row of the box. */
function RowView({ row, preview }: { row: Row; preview: Extract<Preview, { kind: 'pull' }> }) {
  const name = (
    <span className="whitespace-nowrap">
      {preview.repo} <span className="text-fg-muted tabular-nums">#{preview.number}</span>
    </span>
  );
  if (row.kind === 'as') {
    return (
      <>
        <svg
          className="lo-i lo-i--sm flex-none text-fg-muted"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <circle cx="8" cy="5.25" r="2.75" />
          <path d="M3 13.5c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" />
        </svg>
        <span className="whitespace-nowrap">Open as {row.login}</span>
        <span className="min-w-0 truncate text-fg-muted text-small">
          {name} {preview.title ?? ''}
        </span>
      </>
    );
  }
  const as =
    preview.as.kind === 'account'
      ? `as ${preview.as.login}`
      : preview.as.kind === 'anonymous'
        ? 'read only, without signing in'
        : '';
  return (
    <>
      {name}
      <span className="min-w-0 truncate">{preview.title ?? ''}</span>
      <span className="ms-auto flex flex-none items-center gap-8">
        {preview.state !== null && <Tag>{STATE_WORDS[preview.state]}</Tag>}
        <span className="text-fg-muted text-small">{as}</span>
      </span>
    </>
  );
}

/** What the foot says about what's in the box, when there's something to say. */
function footNote(preview: Preview | undefined): string | undefined {
  if (preview === undefined || preview.kind === 'empty') {
    return 'Links to a pull request’s files, commits and checks open the pull request.';
  }
  if (preview.kind === 'pull' && preview.as.kind === 'ask') {
    return `Lo remembers the account you choose for ${preview.owner}.`;
  }
  return undefined;
}

/** The open box, over the window while it's open. */
export function OpenBox() {
  const state = useStore(boxStore);
  useKeys();
  const preview = currentPreview(state);
  const rows = rowsFor(preview);
  const action = enterAction(preview, state.text);
  const message = state.error ?? messageFor(preview, state.text, state.opening);
  return (
    <Palette<Row>
      open={state.open}
      onOpenChange={(next) => {
        if (!next) closeBox();
      }}
      onClosed={boxClosed}
      label="Open a pull request"
      placeholder="Paste a link to a pull request"
      keys={keyOf('open.box')}
      mono
      icon={LINK_ICON}
      mode={state.fromClipboard ? 'from clipboard' : undefined}
      query={state.text}
      onQueryChange={typeText}
      groups={rows.length === 0 ? [] : [{ items: rows }]}
      itemId={(row) => row.id}
      onRun={(row) => {
        if (state.opening) return;
        if (row.kind === 'as') void openAs(row.login);
        else void openText(state.text);
      }}
      onSubmit={submit}
      renderItem={(row) =>
        preview?.kind === 'pull' ? <RowView row={row} preview={preview} /> : null
      }
      message={
        typeof message === 'string' ? (
          <Message icon={WARN_ICON} title="Lo didn’t open it">
            <span className="text-fg-muted text-small">{message}</span>
          </Message>
        ) : (
          message
        )
      }
      empty={null}
      foot={
        <>
          <span className="min-w-0">{footNote(preview)}</span>
          <span className="flex-1" />
          {action !== undefined && <PaletteHint keys={labels('enter')}>{action}</PaletteHint>}
          <PaletteHint keys={labels('esc')}>Close</PaletteHint>
        </>
      }
      container={document.getElementById('root')}
    />
  );
}
