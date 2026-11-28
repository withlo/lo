// Edit term in the window: it opens on a term as the store holds it, or its draft; the notes that
// dim Save, and why it's dimmed without one; one paragraph; the draft kept as it closes and
// discarded; and what saving came to: closed, the conflict with theirs for "Save mine", a failure
// with why, and an answer lost, which "Check again" settles. And why it can't open.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab, PullView } from '../../tab/window/shared.ts';
import { readDraft, readTerms } from '../background/index.ts';
import type { EditOutcome, StoreState, TermEdit, TermNow } from '../contract.ts';
import {
  changeAliases,
  changeDefinition,
  checkEdit,
  closeEdit,
  discardDraft,
  editNotes,
  editRefusal,
  editStore,
  editWith,
  forgetDrafts,
  openEdit,
  saveEdit,
  saveLabel,
  saveOff,
  type EditOpen,
} from './edit.ts';
import { storeStates, terms } from './terms.ts';

const TAB: PullTab = { id: 't1', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 80 };
const REPO = { owner: 'rozed-dev', name: 'e2e' };

/** A term of `terms.json`, as an agent defined it. */
function agents(name: string, definition: string, aliases: string[] = []) {
  return {
    term: name,
    definition,
    ...(aliases.length > 0 ? { aliases } : {}),
    written: 'agent',
    by: { login: 'elle-kzn' },
    from: '#80',
    at: '2026-11-11T09:30:00Z',
  };
}

/** `terms.json` of `bucket` and `tenant`, as agents defined them. */
function storeBytes(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: 1,
      terms: {
        bucket: agents('bucket', 'The tokens a tenant has.', ['buckets']),
        tenant: agents('tenant', 'Who pays.'),
      },
    }),
  );
}

/** Tab {@link TAB}'s repository's definitions, as read, and what main says of them. */
function given(state: Partial<StoreState> = {}): void {
  const read = readTerms(storeBytes());
  if (!read.ok) throw new Error(read.problem.message);
  terms.set(TAB.id, {
    kind: 'read',
    repository: REPO,
    terms: {
      format: read.format,
      terms: new Map(read.terms.map((term) => [term.key, term])),
      names: new Map(read.names),
    },
    saved: false,
    checkedAt: 1,
    problem: null,
  });
  storeStates.set(TAB.id, {
    id: TAB.id,
    repository: REPO,
    found: { kind: 'file', commit: 'a'.repeat(40), id: 'b'.repeat(40), size: 10 },
    saved: false,
    checkedAt: 1,
    problem: null,
    push: true,
    ...state,
  });
}

/** The tab's pull request as the window has it: only who it acts as is read. */
const said = vi.hoisted(() => ({ pull: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => said.pull,
}));

/** The tab acting as `login`, or as nobody. */
function acting(login: string | undefined): void {
  const view: Pick<PullView, 'id' | 'acting'> = {
    id: TAB.id,
    acting: login === undefined ? { kind: 'anonymous' } : { kind: 'account', login },
  };
  said.pull = view;
}

/** What main is asked, and answers each edit and check with. */
let sent: TermEdit[];
let answers: EditOutcome[];
let checked: string[];

function open(): EditOpen {
  const now = editStore.getState().open;
  if (!now) throw new Error('Edit term isn’t open.');
  return now;
}

/** Lets the background process's reads of the draft land. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) await Promise.resolve();
}

let undo: () => void;

beforeEach(() => {
  sent = [];
  answers = [];
  checked = [];
  forgetDrafts();
  acting('ravi-k');
  given();
  undo = editWith({
    edit: async ({ edit }) => {
      sent.push(edit);
      return answers.shift() ?? { kind: 'saved' };
    },
    check: async ({ commit }) => {
      checked.push(commit);
      return answers.shift() ?? { kind: 'saved' };
    },
    draft: async (input) => readDraft(input),
  });
});

afterEach(() => {
  undo();
  forgetDrafts();
});

/** The notes over the buttons now. */
function notes(): string[] {
  const known = terms.get(TAB.id);
  return editNotes(open(), known.kind === 'read' ? known.terms.names : undefined);
}

describe('Edit term', () => {
  it('opens on the term as the store holds it, by any name, and dims Save until it changes', async () => {
    expect(openEdit(TAB.id, 'buckets')).toBe(true);
    await settle();
    expect(open()).toMatchObject({
      key: 'bucket',
      term: 'bucket',
      base: { definition: 'The tokens a tenant has.', aliases: ['buckets'] },
      definition: 'The tokens a tenant has.',
      aliases: 'buckets',
      draftAt: undefined,
      step: { kind: 'ask' },
    });
    expect(saveOff(open(), notes())).toBe('Nothing changed');
    expect(saveLabel(open())).toBe('Save');
    changeDefinition('What a tenant spends from.');
    await settle();
    expect(saveOff(open(), notes())).toBeUndefined();
    changeDefinition('   ');
    expect(saveOff(open(), notes())).toBe('Write a definition first');
    expect(openEdit(TAB.id, 'quota')).toBe(false);
  });

  it('keeps the definition one paragraph: a pasted line break is a space', () => {
    openEdit(TAB.id, 'bucket');
    changeDefinition('What a tenant\nspends\r\nfrom.');
    expect(open().definition).toBe('What a tenant spends from.');
  });

  it('notes what can’t be saved, each dimming Save, the first its reason', async () => {
    openEdit(TAB.id, 'bucket');
    changeDefinition('x'.repeat(401));
    await settle();
    expect(notes()).toEqual(['Too long by 1 character']);
    expect(saveOff(open(), notes())).toBe('Too long by 1 character');
    changeDefinition('Spent **fast**.');
    await settle();
    expect(notes()).toEqual(['Bold text can’t be in a definition']);
    changeDefinition('See [it](https://example.com).');
    await settle();
    expect(notes()).toEqual(['Links go into the code or to a term']);
    changeDefinition('Spent by a [tenant](term:tenant), in a [bukket](term:bukket).');
    changeAliases('pail, Tenant');
    await settle();
    expect(notes()).toEqual(['No term matches “bukket”', '“Tenant” is another term']);
  });

  it('keeps an edit not saved as the term’s draft, which “Discard draft” takes back', async () => {
    openEdit(TAB.id, 'bucket', 1_000);
    changeDefinition('Mine.');
    closeEdit(2_000);
    expect(openEdit(TAB.id, 'bucket', 3_000)).toBe(true);
    expect(open()).toMatchObject({ definition: 'Mine.', draftAt: 2_000 });
    discardDraft();
    expect(open()).toMatchObject({ definition: 'The tokens a tenant has.', draftAt: undefined });
    closeEdit(4_000);
    openEdit(TAB.id, 'bucket', 5_000);
    expect(open().draftAt).toBeUndefined();
  });

  it('saves as written, from the term as it opened, and closes', async () => {
    openEdit(TAB.id, 'bucket');
    changeDefinition('  What a tenant spends from.  ');
    changeAliases('buckets, , token bucket');
    await saveEdit();
    expect(sent).toEqual([
      {
        key: 'bucket',
        term: 'bucket',
        base: { definition: 'The tokens a tenant has.', aliases: ['buckets'] },
        definition: 'What a tenant spends from.',
        aliases: ['buckets', 'token bucket'],
      },
    ]);
    expect(editStore.getState().open).toBeUndefined();
    // Saved, the draft goes.
    openEdit(TAB.id, 'bucket');
    expect(open().draftAt).toBeUndefined();
  });

  it('comes back over the field with theirs, changed since, and “Save mine” saves over theirs', async () => {
    const theirs: TermNow = {
      term: 'bucket',
      definition: 'Theirs, with `code`.',
      aliases: [],
      written: 'human',
      by: { login: 'elle-kzn' },
      from: 'lo',
      at: '2026-11-28T11:58:00Z',
    };
    answers.push({ kind: 'changed', term: theirs });
    openEdit(TAB.id, 'bucket');
    changeDefinition('Mine.');
    await saveEdit();
    await settle();
    expect(open()).toMatchObject({
      step: { kind: 'ask' },
      base: { definition: 'Theirs, with `code`.', aliases: [] },
      conflict: { term: theirs, read: { ok: true } },
      definition: 'Mine.',
    });
    expect(saveLabel(open())).toBe('Save mine');
    await saveEdit();
    expect(sent.at(-1)?.base).toEqual({ definition: 'Theirs, with `code`.', aliases: [] });
    expect(editStore.getState().open).toBeUndefined();
  });

  it('adds back a term deleted since', async () => {
    answers.push({ kind: 'changed', term: null });
    openEdit(TAB.id, 'bucket');
    changeDefinition('Mine.');
    await saveEdit();
    expect(open()).toMatchObject({ base: null, conflict: { term: null } });
    expect(saveOff(open(), notes())).toBeUndefined();
    await saveEdit();
    expect(sent.at(-1)?.base).toBeNull();
  });

  it('says why it failed, as the account and the repository have it', async () => {
    const reasons: [EditOutcome, string][] = [
      [
        { kind: 'refused', why: 'push', details: null },
        'ravi-k doesn’t have push access to rozed-dev/e2e.',
      ],
      [{ kind: 'refused', why: 'rule', details: 'x' }, 'A rule in rozed-dev/e2e blocks it.'],
      [{ kind: 'refused', why: 'changing', details: null }, 'The glossary kept changing.'],
      [{ kind: 'failed', cause: { kind: 'offline' }, details: null }, 'Offline.'],
      [{ kind: 'unreadable', why: { kind: 'tooLarge' } }, 'It’s larger than 2 MB.'],
    ];
    for (const [outcome, reason] of reasons) {
      answers.push(outcome);
      openEdit(TAB.id, 'bucket');
      changeDefinition('Mine.');
      await saveEdit();
      expect(open().step).toMatchObject({ kind: 'failed', reason });
      closeEdit();
    }
  });

  it('settles an answer lost with “Check again”, which only looks', async () => {
    const commit = 'c'.repeat(40);
    answers.push({ kind: 'unconfirmed', commit, details: 'fetch failed' });
    openEdit(TAB.id, 'bucket');
    changeDefinition('Mine.');
    await saveEdit();
    expect(open().step).toEqual({
      kind: 'unconfirmed',
      commit,
      details: 'fetch failed',
      checking: false,
    });
    answers.push({ kind: 'failed', cause: { kind: 'timeout' }, details: null });
    await checkEdit();
    expect(checked).toEqual([commit]);
    expect(sent).toHaveLength(1);
    expect(open().step).toMatchObject({ kind: 'failed', reason: 'GitHub didn’t respond.' });
  });

  it('stays open while it saves', async () => {
    const answer = Promise.withResolvers<EditOutcome>();
    undo();
    undo = editWith({
      edit: () => answer.promise,
      check: async () => ({ kind: 'saved' }),
      draft: async (input) => readDraft(input),
    });
    openEdit(TAB.id, 'bucket');
    changeDefinition('Mine.');
    const saving = saveEdit();
    closeEdit();
    expect(open().step).toEqual({ kind: 'working' });
    expect(editRefusal(TAB, 'bucket')).toBe('Saving…');
    answer.resolve({ kind: 'saved' });
    await saving;
    expect(editStore.getState().open).toBeUndefined();
  });
});

describe('why Edit term can’t open', () => {
  it('says so in the refusals’ words', () => {
    expect(editRefusal(TAB, 'bucket')).toBe(true);
    expect(editRefusal(TAB, 'quota')).toBe('Joins the glossary when #80 merges');
    expect(editRefusal({ ...TAB, state: 'merged' }, 'quota')).toBe('Not in the glossary');
    given({ push: false });
    expect(editRefusal(TAB, 'bucket')).toBe('Needs push access to rozed-dev/e2e');
    acting(undefined);
    expect(editRefusal(TAB, 'bucket')).toBe('Sign in to edit terms');
    acting('ravi-k');
    terms.set(TAB.id, { kind: 'reading' });
    expect(editRefusal(TAB, 'bucket')).toBe('Reading the glossary…');
    terms.set(TAB.id, { kind: 'none', repository: REPO, problem: null });
    expect(editRefusal(TAB, 'bucket')).toBe('This repo has no glossary');
  });
});
