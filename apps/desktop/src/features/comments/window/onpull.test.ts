// What the reader wrote on a pull request itself that its timeline doesn't show yet, as the box it
// came from says how it stands: there from the moment it's sent, kept once GitHub has it until the
// timeline shows it, and gone if it fails, its text back in the box.

import { describe, expect, test } from 'vitest';

import type { DraftPlaceRow } from '../contract.ts';
import { noted, noteOnPull, onPull, settleOnPull, type BoxSend, type OnPull } from './onpull.ts';
import { sentLabel } from './writing.ts';

const ON_PULL: DraftPlaceRow = { kind: 'conversation' };

function box(changes: Partial<BoxSend> = {}): BoxSend {
  return {
    key: 'box-1',
    view: 'view-1',
    place: ON_PULL,
    text: 'Ship it.',
    held: true,
    landing: false,
    sending: 'sending',
    send: 1,
    sentAt: 5_000,
    before: { had: 1, after: 'C_9' },
    copy: undefined,
    editedAt: undefined,
    ...changes,
  };
}

describe('noted', () => {
  test('a comment is there from the moment it’s sent, says it’s checked for, then has its time', () => {
    const sending = noted([], box(), 10);
    expect(sending).toEqual<OnPull[]>([
      {
        key: 'box-1',
        comment: undefined,
        text: 'Ship it.',
        state: 'sending',
        label: sentLabel('sending', false),
        at: undefined,
        send: 1,
        sentAt: 5_000,
        before: { had: 1, after: 'C_9' },
        copy: undefined,
        editedAt: undefined,
      },
    ]);
    // The same again changes nothing.
    expect(noted(sending, box(), 11)).toBe(sending);
    const checking = noted(sending, box({ sending: 'checking' }), 12);
    expect(checking[0]).toMatchObject({ state: 'checking', label: sentLabel('checking', false) });
    const taken = noted(checking, box({ landing: true }), 13);
    expect(taken[0]).toMatchObject({ state: 'sent', at: 13 });
    // Taken, it stays as the box closes, until the timeline shows it.
    expect(noted(taken, box({ held: false, landing: false, sending: null, text: '' }), 14)).toBe(
      taken,
    );
  });

  test('what GitHub’s answer says comes to one taken, as after main’s drafts said so', () => {
    const taken = noted([], box({ landing: true }), 10);
    const named = noted(taken, box({ held: false, copy: 'IC_9' }), 11);
    expect(named[0]).toMatchObject({ state: 'sent', at: 10, copy: 'IC_9' });
    expect(noted(named, box({ held: false, copy: 'IC_9' }), 12)).toBe(named);
    const place: DraftPlaceRow = { kind: 'edit', thread: null, comment: 'IC_1' };
    const edited = noted([], box({ place, landing: true }), 10);
    expect(noted(edited, box({ place, held: false, editedAt: 9_000 }), 11)[0]).toMatchObject({
      comment: 'IC_1',
      editedAt: 9_000,
    });
  });

  test('one that fails goes, its text back in the box', () => {
    const sending = noted([], box(), 10);
    expect(noted(sending, box({ held: false, sending: null }), 11)).toEqual([]);
  });

  test('an edit on the pull request itself is of its comment, and is saved', () => {
    const place: DraftPlaceRow = { kind: 'edit', thread: null, comment: 'IC_1' };
    expect(noted([], box({ place }), 10)[0]).toMatchObject({
      comment: 'IC_1',
      label: sentLabel('sending', true),
    });
  });

  test('what’s written on a file’s lines isn’t the timeline’s', () => {
    const before: OnPull[] = [];
    const reply: DraftPlaceRow = { kind: 'reply', thread: 'PRRT_1' };
    expect(noted(before, box({ place: reply }), 10)).toBe(before);
    const edit: DraftPlaceRow = { kind: 'edit', thread: 'PRRT_1', comment: 'PRRC_1' };
    expect(noted(before, box({ place: edit }), 10)).toBe(before);
  });
});

describe('noteOnPull', () => {
  test('one the timeline showed never comes back for that send, as its box says it was taken', () => {
    const view = 'view-settled';
    noteOnPull(box({ view }));
    expect(onPull.get(view)).toHaveLength(1);
    settleOnPull(view, new Set(['box-1']));
    expect(onPull.get(view)).toEqual([]);
    noteOnPull(box({ view, landing: true }));
    expect(onPull.get(view)).toEqual([]);
    // Sent again, it's there again.
    noteOnPull(box({ view, send: 2 }));
    expect(onPull.get(view)).toMatchObject([{ key: 'box-1', send: 2 }]);
  });
});
