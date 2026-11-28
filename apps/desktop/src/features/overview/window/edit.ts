// Edit term in the window: the dialog's state, one at a time, for a term of a pull request's tab's
// repository's definitions; the draft of each term, kept until the window closes; what the edit
// being written reads as, from the background process; the notes that dim Save, and why it's
// dimmed without one; and saving, as main writes it, with what came of it: saved, which closes the
// dialog; the term changed since it opened, which goes back to asking with theirs, for "Save mine";
// failed, with why; or not known, which "Check again" settles by reading the store, sending
// nothing.

import { ago, type DialogState } from '@lo/ui';
import { createStore } from 'zustand/vanilla';

import { IpcError } from '../../../ipc/contract.ts';
import { explain } from '../../../window/explain.ts';
import { pullOf, type PullTab } from '../../tab/window/shared.ts';
import type { EditBase, EditOutcome, TermEdit, TermNow } from '../contract.ts';
import type { DraftRead } from '../jobs.ts';
import { main, overviewJobs } from './main.ts';
import { storeReason } from './says.ts';
import { failureOf, storedTerm, storeStates, terms, type RepoName, type Terms } from './terms.ts';

/** The most characters a definition is written in: a sentence or two. */
export const DEFINITION_LIMIT = 400;

/** The dialog's title. */
export const EDIT_TITLE = 'Edit term';

/** What a failure says over the buttons. */
export const SAVE_FAILED = 'Couldn’t save the term';

/** What it says when GitHub's answer was lost, and the store couldn't be read to tell. */
export const SAVE_UNCONFIRMED = 'Save not confirmed';

/** A term's edit kept from a dialog closed before it was saved. */
export interface EditDraft {
  readonly definition: string;
  readonly aliases: string;
  /** The term as the edit started from it. */
  readonly base: EditBase | null;
  /** When it was last changed. */
  readonly at: number;
}

/**
 * Where saving has got to: `ask`, before it's sent, and after a conflict; `working`, sent; `failed`,
 * with why; `unconfirmed`, GitHub's answer lost, with the commit "Check again" looks for, and whether
 * it's looking.
 */
export type EditStep =
  | { kind: 'ask' }
  | { kind: 'working' }
  | { kind: 'failed'; reason: string | undefined; details: string | undefined }
  | { kind: 'unconfirmed'; commit: string; details: string | undefined; checking: boolean };

/** The term changed since the edit started: as it is now, none for one deleted, as it reads. */
export interface EditConflict {
  readonly term: TermNow | null;
  /** Theirs, read as the store holds it, once read. */
  readonly read: DraftRead['definition'] | undefined;
}

/** The dialog, open on a term. */
export interface EditOpen {
  /** The pull request's tab whose repository's definitions hold the term. */
  readonly tab: string;
  readonly repository: RepoName;
  /** The account it's saved as, the tab's. */
  readonly login: string | undefined;
  readonly key: string;
  /** The term as written: it can't be renamed. */
  readonly term: string;
  /** The term as the edit started from it, or theirs after a conflict; none for one deleted. */
  readonly base: EditBase | null;
  /** The definition and other forms as written in the dialog. */
  readonly definition: string;
  readonly aliases: string;
  /** When the draft it opened with was written, for one kept from before, until it's changed. */
  readonly draftAt: number | undefined;
  readonly step: EditStep;
  readonly conflict: EditConflict | undefined;
  /** What the edit as written reads as, and the text it was read for. */
  readonly read: { readonly for: string; readonly value: DraftRead } | undefined;
}

export const editStore = createStore<{ open: EditOpen | undefined }>()(() => ({
  open: undefined,
}));

/** What Edit term asks of main and the background process. */
export interface EditCalls {
  edit(input: { id: string; edit: TermEdit }): Promise<EditOutcome>;
  check(input: { id: string; commit: string }): Promise<EditOutcome>;
  draft(input: { term: string; definition: string; aliases: string[] }): Promise<DraftRead>;
}

let calls: EditCalls = {
  edit: (input) => main().editTerm(input),
  check: (input) => main().checkEdit(input),
  draft: (input) => overviewJobs().draft(input),
};

/** Asks `using` in place of main and the background process, until the function it returns. */
export function editWith(using: EditCalls): () => void {
  const before = calls;
  calls = using;
  return () => {
    calls = before;
  };
}

/** Each term's draft, by its repository and key, until the window closes. */
const drafts = new Map<string, EditDraft>();

function draftKey(repository: RepoName, key: string): string {
  return `${repository.owner}/${repository.name}`.toLowerCase() + `\n${key}`;
}

function openNow(): EditOpen | undefined {
  return editStore.getState().open;
}

function setOpen(change: (open: EditOpen) => EditOpen): void {
  const open = openNow();
  if (open) editStore.setState({ open: change(open) });
}

/** Tab `tab`'s repository's definitions, where they're read. */
function readTerms(tab: string): { repository: RepoName; terms: Terms } | undefined {
  const known = terms.get(tab);
  return known.kind === 'read' ? { repository: known.repository, terms: known.terms } : undefined;
}

/** The text of `aliases` as the field shows them: "buckets, token bucket". */
export function aliasesText(aliases: readonly string[]): string {
  return aliases.join(', ');
}

/** The other forms written in the field, split by commas, each trimmed, none empty. */
export function aliasesIn(text: string): string[] {
  return text
    .split(',')
    .map((each) => each.trim())
    .filter((each) => each !== '');
}

/** `text` as one paragraph: each line break, a pasted one, as a space. */
export function oneParagraph(text: string): string {
  return text.replace(/\r\n|[\n\r\u2028\u2029]/g, ' ');
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * How many characters `text` is, as it's counted against {@link DEFINITION_LIMIT}: as a reader
 * counts them, an emoji or a letter with its accents as one.
 */
export function charactersIn(text: string): number {
  let count = 0;
  for (const _ of graphemes.segment(text)) count += 1;
  return count;
}

/**
 * Why term `name`, by any name it goes by, of pull request's tab `tab`'s repository's definitions
 * can't be edited now, as `terms.edit` refuses: without an account, before they're read, where
 * there are none or they can't be read, for a term they don't hold, without push access, offline,
 * and while an edit of it is saving. True where it can.
 */
export function editRefusal(tab: PullTab, name: string): true | string {
  const acting = pullOf(tab.id)?.acting;
  if (acting?.kind !== 'account') return 'Sign in to edit terms';
  const known = terms.get(tab.id);
  switch (known.kind) {
    case 'reading':
      return 'Reading the glossary…';
    case 'none':
      return 'This repo has no glossary';
    case 'unreadable':
      return known.why.kind === 'problem' && known.why.problem.kind === 'offline'
        ? 'Offline'
        : 'The glossary can’t be read';
    case 'read':
      break;
    default:
      known satisfies never;
      return 'Reading the glossary…';
  }
  const stored = storedTerm(known.terms, name);
  if (!stored) {
    // A term of the overview's own: a new one joins as its pull request merges.
    const open = tab.state === undefined || tab.state === 'open' || tab.state === 'draft';
    return open
      ? `Joins the glossary when #${tab.layer ?? tab.number} merges`
      : 'Not in the glossary';
  }
  const state = storeStates.get(tab.id);
  if (state?.push === false) {
    return `Needs push access to ${known.repository.owner}/${known.repository.name}`;
  }
  if (known.problem?.kind === 'offline') return 'Offline';
  const open = openNow();
  if (open?.tab === tab.id && open.key === stored.key && open.step.kind === 'working') {
    return 'Saving…';
  }
  return true;
}

/**
 * Opens Edit term on term `name`, by any name it goes by, of tab `tab`'s repository's definitions,
 * with its draft if one was kept, else as the store holds it. Nothing opens where they aren't read
 * or don't hold it.
 */
export function openEdit(tab: string, name: string, now = Date.now()): boolean {
  const known = readTerms(tab);
  const stored = known && storedTerm(known.terms, name);
  if (!known || !stored) return false;
  const { key } = stored;
  const acting = pullOf(tab)?.acting;
  const draft = drafts.get(draftKey(known.repository, key));
  editStore.setState({
    open: {
      tab,
      repository: known.repository,
      login: acting?.kind === 'account' ? acting.login : undefined,
      key,
      term: stored.term,
      base: draft ? draft.base : { definition: stored.definition, aliases: [...stored.aliases] },
      definition: draft?.definition ?? stored.definition,
      aliases: draft?.aliases ?? aliasesText(stored.aliases),
      draftAt: draft && Math.min(draft.at, now),
      step: { kind: 'ask' },
      conflict: undefined,
      read: undefined,
    },
  });
  void readDraft();
  return true;
}

/** Reads the edit as written in the background process, unless it's read already. */
async function readDraft(): Promise<void> {
  const open = openNow();
  if (!open) return;
  const asked = `${open.definition}\n${open.aliases}`;
  if (open.read?.for === asked) return;
  let value: DraftRead;
  try {
    value = await calls.draft({
      term: open.term,
      definition: open.definition,
      aliases: aliasesIn(open.aliases),
    });
  } catch (error) {
    console.error('Lo couldn’t read the definition being written:', error);
    return;
  }
  setOpen((now) =>
    `${now.definition}\n${now.aliases}` === asked ? { ...now, read: { for: asked, value } } : now,
  );
}

/** The definition as written, as one paragraph. */
export function changeDefinition(text: string): void {
  setOpen((open) => ({ ...open, definition: oneParagraph(text), draftAt: undefined }));
  void readDraft();
}

export function changeAliases(text: string): void {
  setOpen((open) => ({ ...open, aliases: text, draftAt: undefined }));
  void readDraft();
}

/** "Discard draft": the saved definition back, and the draft gone. */
export function discardDraft(): void {
  const open = openNow();
  if (!open) return;
  drafts.delete(draftKey(open.repository, open.key));
  const stored = readTerms(open.tab)?.terms.terms.get(open.key);
  const base = stored ? { definition: stored.definition, aliases: [...stored.aliases] } : open.base;
  editStore.setState({
    open: {
      ...open,
      base,
      definition: base?.definition ?? '',
      aliases: aliasesText(base?.aliases ?? []),
      draftAt: undefined,
      conflict: undefined,
      step: { kind: 'ask' },
    },
  });
  void readDraft();
}

/**
 * The keys `names` go by, each once, in order: as `@lo/artifact`'s `termKey` makes them, in lower
 * case with each run of white space as one space.
 */
function keysOf(names: readonly string[]): string[] {
  const keys = names.map((name) => name.replace(/\s+/g, ' ').trim().toLowerCase());
  return [...new Set(keys)].toSorted();
}

/** Whether the edit as written is the term as it started: nothing to save. */
function unchanged(open: EditOpen): boolean {
  if (open.base === null) return false;
  if (open.definition.trim() !== open.base.definition.trim()) return false;
  const now = keysOf(aliasesIn(open.aliases));
  return JSON.stringify(now) === JSON.stringify(keysOf(open.base.aliases));
}

/**
 * Closes the dialog, unless it's saving, which can't be left: an edit not saved is kept as the
 * term's draft, and one as the term is drops its draft.
 */
export function closeEdit(now = Date.now()): void {
  const open = openNow();
  if (!open || open.step.kind === 'working') return;
  const key = draftKey(open.repository, open.key);
  if (unchanged(open)) drafts.delete(key);
  else {
    const kept = drafts.get(key);
    const same =
      kept?.definition === open.definition &&
      kept.aliases === open.aliases &&
      kept.base === open.base;
    drafts.set(key, {
      definition: open.definition,
      aliases: open.aliases,
      base: open.base,
      // Reopened and closed as it was, it's as old as it was.
      at: same ? kept.at : now,
    });
  }
  editStore.setState({ open: undefined });
}

/**
 * The notes over the buttons, each of which dims Save: past the length a definition is written in;
 * what it holds that a definition can't; a link to a term the definitions don't hold; and another
 * form that's another term's.
 */
export function editNotes(
  open: Pick<EditOpen, 'key' | 'definition' | 'read'>,
  names: ReadonlyMap<string, string> | undefined,
): string[] {
  const notes: string[] = [];
  const over = charactersIn(open.definition) - DEFINITION_LIMIT;
  if (over > 0) notes.push(`Too long by ${over} ${over === 1 ? 'character' : 'characters'}`);
  const read = open.read?.value;
  if (!read) return notes;
  const { definition } = read;
  if (!definition.ok) notes.push(holdsNote(definition.what, definition.why));
  else if (names) {
    for (const key of definition.terms) {
      if (!names.has(key) && key !== open.key) notes.push(`No term matches “${key}”`);
    }
  }
  for (const alias of read.aliases) {
    const owner = names?.get(alias.key);
    if (owner !== undefined && owner !== open.key) notes.push(`“${alias.name}” is another term`);
  }
  return notes;
}

/**
 * The note for what a definition holds that it can't, `what`: why, for a link whose address is
 * wrong; for any other link, where links go, as one to a page or an issue goes nowhere they may.
 */
function holdsNote(what: string, why: string | null): string {
  if (why !== null) return why.replace(/\.$/, '');
  if (/\blinks?\b/.test(what)) return 'Links go into the code or to a term';
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} can’t be in a definition`;
}

/** Why Save is dimmed, if it is: the first note, or nothing written, or nothing changed. */
export function saveOff(open: EditOpen, notes: readonly string[]): string | undefined {
  if (notes.length > 0) return notes[0];
  if (open.definition.trim() === '') return 'Write a definition first';
  if (unchanged(open)) return 'Nothing changed';
  return undefined;
}

/** What the main button says: "Save mine" over a conflict, else "Save". */
export function saveLabel(open: EditOpen): string {
  return open.conflict ? 'Save mine' : 'Save';
}

/** The dialog's state, as its foot shows it. */
export function dialogStateOf(step: EditStep): DialogState {
  switch (step.kind) {
    case 'ask':
      return 'ask';
    case 'working':
      return 'working';
    case 'failed':
    case 'unconfirmed':
      return 'failed';
    default:
      step satisfies never;
      return 'ask';
  }
}

/** "Changed by elle-kzn · 2 min ago", over the field, for a term changed since it opened. */
export function changedLine(term: TermNow, now: number): string {
  const by = 'login' in term.by ? term.by.login : term.by.name;
  const at = Date.parse(term.at);
  return Number.isNaN(at) ? `Changed by ${by}` : `Changed by ${by} · ${ago(at, now)}`;
}

/** "Draft from 12 min ago", over the buttons, for a draft kept from before. */
export function draftLine(at: number, now: number): string {
  return `Draft from ${ago(at, now)}`;
}

/**
 * Saves the edit as written, as the tab's account, unless Save is dimmed or it's saving: in place
 * of the term as it started, or of theirs after a conflict, or adding it back for one deleted.
 */
export async function saveEdit(): Promise<void> {
  const open = openNow();
  if (!open || open.step.kind === 'working') return;
  const notes = editNotes(open, readTerms(open.tab)?.terms.names);
  if (saveOff(open, notes) !== undefined) return;
  const edit: TermEdit = {
    key: open.key,
    term: open.term,
    base: open.base,
    definition: open.definition.trim(),
    aliases: aliasesIn(open.aliases),
  };
  setOpen((now) => ({ ...now, step: { kind: 'working' } }));
  let outcome: EditOutcome;
  try {
    outcome = await calls.edit({ id: open.tab, edit });
  } catch (error) {
    console.error('Lo couldn’t save the term:', error);
    outcome = {
      kind: 'failed',
      cause: { kind: 'unknown' },
      details: error instanceof IpcError ? error.message : String(error),
    };
  }
  settle(open, outcome);
}

/** "Check again": whether the store holds the edit whose answer was lost, sending nothing. */
export async function checkEdit(): Promise<void> {
  const open = openNow();
  if (open?.step.kind !== 'unconfirmed' || open.step.checking) return;
  const { commit } = open.step;
  setOpen((now) =>
    now.step.kind === 'unconfirmed' ? { ...now, step: { ...now.step, checking: true } } : now,
  );
  let outcome: EditOutcome;
  try {
    outcome = await calls.check({ id: open.tab, commit });
  } catch (error) {
    console.error('Lo couldn’t check the term was saved:', error);
    outcome = { kind: 'unconfirmed', commit, details: String(error) };
  }
  settle(open, outcome);
}

/** Takes what saving `asked`, the dialog as it was sent, came to, if it's still open on it. */
function settle(asked: EditOpen, outcome: EditOutcome): void {
  const open = openNow();
  if (!open || open.tab !== asked.tab || open.key !== asked.key) return;
  const failed = (reason: string | undefined, details: string | null) =>
    editStore.setState({
      open: { ...open, step: { kind: 'failed', reason, details: details ?? undefined } },
    });
  const where = `${asked.repository.owner}/${asked.repository.name}`;
  switch (outcome.kind) {
    case 'saved':
      drafts.delete(draftKey(open.repository, open.key));
      editStore.setState({ open: undefined });
      return;
    case 'changed':
      editStore.setState({
        open: {
          ...open,
          base: outcome.term && {
            definition: outcome.term.definition,
            aliases: [...outcome.term.aliases],
          },
          step: { kind: 'ask' },
          conflict: { term: outcome.term, read: undefined },
        },
      });
      void readTheirs();
      return;
    case 'refused':
      failed(refusedReason(outcome.why, asked.login, where), outcome.details);
      return;
    case 'invalid':
      failed(outcome.message, null);
      return;
    case 'unreadable': {
      const { why } = outcome;
      const failure =
        why.kind === 'store'
          ? failureOf(why.problem)
          : why.kind === 'notStore'
            ? { kind: 'notStore' as const, why: why.why }
            : { kind: 'tooLarge' as const };
      if (failure.kind === 'problem') {
        failed(undefined, null);
        return;
      }
      const said = storeReason(failure);
      failed(said.cause || undefined, said.details ?? null);
      return;
    }
    case 'failed':
      failed(explain(outcome.cause), outcome.details);
      return;
    case 'unconfirmed':
      editStore.setState({
        open: {
          ...open,
          step: {
            kind: 'unconfirmed',
            commit: outcome.commit,
            details: outcome.details ?? undefined,
            checking: false,
          },
        },
      });
      return;
    default:
      outcome satisfies never;
      failed(undefined, null);
  }
}

/** Why GitHub refused an edit, `why`, as the failure over the buttons says it. */
function refusedReason(
  why: 'push' | 'rule' | 'changing',
  login: string | undefined,
  where: string,
): string {
  switch (why) {
    case 'push':
      return `${login ?? 'This account'} doesn’t have push access to ${where}.`;
    case 'rule':
      return `A rule in ${where} blocks it.`;
    case 'changing':
      return 'The glossary kept changing.';
    default:
      why satisfies never;
      return '';
  }
}

/** Reads theirs, the term as a conflict found it, as the store holds it, to show it as prose. */
async function readTheirs(): Promise<void> {
  const open = openNow();
  const term = open?.conflict?.term;
  if (!open || !term) return;
  let read: DraftRead;
  try {
    read = await calls.draft({
      term: term.term,
      definition: term.definition,
      aliases: [],
    });
  } catch (error) {
    console.error('Lo couldn’t read the newer definition:', error);
    return;
  }
  setOpen((now) =>
    now.conflict?.term === term ? { ...now, conflict: { term, read: read.definition } } : now,
  );
}

/** Forgets every draft, as for tests. */
export function forgetDrafts(): void {
  drafts.clear();
  editStore.setState({ open: undefined });
}
