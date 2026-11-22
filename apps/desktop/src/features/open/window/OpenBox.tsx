// The open box (`⌘L`): a link to a pull request, filled in from the clipboard when it holds one,
// with what it opens and as whom, or why it can't, and what `⏎` does about it.

import { Button, Key, Palette, PaletteHint, Problem, Spinner, StatePill, Ticks } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import type { Preview } from '../contract.ts';
import {
  boxClosed,
  boxStore,
  closeBox,
  currentPreview,
  enterAction,
  highlight,
  openAs,
  openText,
  submit,
  takeWay,
  typeText,
  type BoxState,
} from './box.ts';
import { blockedWords, notPullLine, wayLabel, webWords } from './words.ts';

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

/** A wait under the input: a turning ring and what's being done. */
function Waiting({ children }: { children: string }) {
  return (
    <span className="flex items-center gap-8 text-fg-muted">
      <Spinner size="xs" />
      {children}
    </span>
  );
}

/**
 * What a link that isn't a pull request is, under the input: a title, one reason when it changes
 * what the reader does, and the one button `⏎` runs, if there's one.
 */
function Note({
  title,
  reason,
  action,
}: {
  title: string;
  reason?: string | undefined;
  action?: { label: string; onClick: () => void } | undefined;
}) {
  return (
    <>
      {WARN_ICON}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-semibold">{title}</span>
        {reason !== undefined && (
          <span className="text-fg-muted text-small">
            <Ticks text={reason} />
          </span>
        )}
        {action !== undefined && (
          <span className="mt-6 flex">
            <Button size="sm" onClick={action.onClick}>
              {action.label}
              <Key keys={labels('enter')} decorative />
            </Button>
          </span>
        )}
      </div>
    </>
  );
}

/** What the box says under the input, for what's in it, if anything. */
function messageFor(state: BoxState, preview: Preview | undefined): ReactNode {
  const { text, opening, error } = state;
  if (opening) return <Waiting>Opening pull request…</Waiting>;
  if (error !== undefined) {
    return (
      <div className="min-w-0 flex-1">
        <Problem
          title={error.title}
          reason={error.reason === undefined ? undefined : <Ticks text={error.reason} />}
          details={error.details}
          action={
            error.retry === true
              ? { label: 'Try again', onClick: submit, keys: labels('enter') }
              : undefined
          }
        />
      </div>
    );
  }
  if (preview === undefined) {
    return text.trim() === '' ? undefined : <Waiting>Checking link…</Waiting>;
  }
  switch (preview.kind) {
    case 'empty':
    case 'pull':
      return undefined;
    case 'invalid':
      return <Note title="Not a pull request link" reason={notPullLine(preview.why)} />;
    case 'web': {
      const words = webWords(preview);
      return (
        <Note
          title={words.title}
          reason={words.reason}
          action={{ label: words.action, onClick: submit }}
        />
      );
    }
    case 'blocked': {
      const { title, reason, way } = blockedWords(preview.why, preview);
      return (
        <div className="min-w-0 flex-1">
          <Problem
            title={title}
            reason={reason}
            details={preview.details ?? undefined}
            action={
              way === undefined
                ? undefined
                : {
                    label: wayLabel(way),
                    onClick: () => takeWay(way, text),
                    keys: labels('enter'),
                  }
            }
          />
        </div>
      );
    }
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
        ? 'Read only'
        : '';
  return (
    <>
      {name}
      <span className="min-w-0 truncate">{preview.title ?? ''}</span>
      <span className="ms-auto flex flex-none items-center gap-8">
        {preview.state !== null && <StatePill state={preview.state} />}
        <span className="text-fg-muted text-small">{as}</span>
      </span>
    </>
  );
}

/** What the foot says about what's in the box, when there's something to say. */
function footNote(preview: Preview | undefined): string | undefined {
  if (preview?.kind !== 'pull' || preview.as.kind !== 'ask') return undefined;
  return preview.as.remember === 'owner'
    ? `Remembered for every ${preview.owner} repo`
    : `Remembered for ${preview.owner}/${preview.repo}`;
}

/** The open box, over the window while it's open. */
export function OpenBox() {
  const state = useStore(boxStore);
  useKeys();
  const preview = currentPreview(state);
  const rows = rowsFor(preview);
  const note = footNote(preview);
  // The rows say what `⏎` does on them; a message's own button says it everywhere else.
  const action = rows.length > 0 && state.error === undefined ? enterAction(state) : undefined;
  return (
    <Palette<Row>
      open={state.open}
      onOpenChange={(next) => {
        if (!next) closeBox();
      }}
      onClosed={boxClosed}
      label="Open pull request"
      placeholder="Paste a pull request link"
      keys={keyOf('open.box')}
      mono
      icon={LINK_ICON}
      mode={state.fromClipboard ? 'From clipboard' : undefined}
      query={state.text}
      onQueryChange={typeText}
      groups={rows.length === 0 ? [] : [{ items: rows }]}
      itemId={(row) => row.id}
      onRun={(row) => {
        if (state.opening) return;
        if (row.kind === 'as') void openAs(row.login);
        else void openText(state.text);
      }}
      onHighlight={(row) => highlight(row?.kind === 'as' ? row.login : undefined)}
      onSubmit={submit}
      renderItem={(row) =>
        preview?.kind === 'pull' ? <RowView row={row} preview={preview} /> : null
      }
      message={messageFor(state, preview)}
      empty={null}
      foot={
        note === undefined && action === undefined ? undefined : (
          <>
            {note !== undefined && <span className="min-w-0">{note}</span>}
            <span className="flex-1" />
            {action !== undefined && <PaletteHint keys={labels('enter')}>{action}</PaletteHint>}
          </>
        )
      }
      container={document.getElementById('root')}
    />
  );
}
