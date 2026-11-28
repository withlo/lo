// @vitest-environment jsdom
// What main says on `jobs` of a merge write it sends, as it answers, can come after the answer: the
// control that asked stays at work until it comes. Turning auto-merge off, sent, is "Turning off…"
// until main says the write it sent; asking GitHub again how a merge went, which main does about
// the merge itself, is "Checking…" until main says the merge is pending again. Refused, or only a
// read, it's the control's own again as the answer comes.

import { beforeEach, expect, test } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { Confirmed, JobView } from '../contract.ts';
import { askAgain, checking, heardJob, turnOffAutoMerge, turningOff } from './merging.ts';
import { merging, pullKey } from './store.ts';

const HEAD = 'a'.repeat(40);
const TAB = { id: 't1', owner: 'rozed-dev', repo: 'e2e', number: 225 };

/** A merge write of #225, named `key`, standing as `state`. */
function job(key: string, kind: JobView['kind'], state: JobView['state']): JobView {
  return {
    key,
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 225,
    login: 'rozed-bot',
    kind,
    method: null,
    base: 'main',
    head: HEAD,
    already: false,
    state,
    together: null,
  };
}

const ON = '00000000-0000-4000-8000-000000000001';
const OFF = '00000000-0000-4000-8000-000000000002';

let off: Confirmed = { kind: 'sent' };
let asks = true;

installBridge({
  'merge.autoMergeOff': () => off,
  'merge.askAgain': () => asks,
  'merge.dismiss': () => undefined,
});

/** Lets main's answers to what was asked come. */
async function answered(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

beforeEach(() => {
  off = { kind: 'sent' };
  asks = true;
  // Auto-merge turned on by an earlier write, which ended.
  const on = job(ON, 'autoMerge', { kind: 'autoMergeOn' });
  merging.setState({
    dialog: undefined,
    jobs: new Map([[pullKey('rozed-dev', 'e2e', 225), on]]),
    turningOff: new Set(),
    checking: new Set(),
  });
});

test('turning auto-merge off, sent, is at work until main says the write it sent, however late', async () => {
  let done = false;
  const turned = turnOffAutoMerge(TAB).then((sent) => {
    done = sent;
  });
  await answered();
  // Main's answer came first: what it said as it answered is still to come.
  expect(turningOff(TAB)).toBe(true);
  heardJob(job(OFF, 'autoMergeOff', { kind: 'sending' }), true);
  await turned;
  expect(done).toBe(true);
  expect(turningOff(TAB)).toBe(true);
  heardJob(job(OFF, 'autoMergeOff', { kind: 'autoMergeOff' }), true);
  expect(turningOff(TAB)).toBe(false);
});

test('turning auto-merge off, refused, is the button’s own again as the answer comes', async () => {
  off = {
    kind: 'refused',
    refusal: { kind: 'busy', text: '', rules: [], until: null, newer: null },
  };
  await expect(turnOffAutoMerge(TAB)).resolves.toBe(false);
  expect(turningOff(TAB)).toBe(false);
});

test('asking GitHub again about the merge is at work until main says it’s pending again', async () => {
  const pull = pullKey('rozed-dev', 'e2e', 225);
  heardJob(
    job(OFF, 'merge', {
      kind: 'unknown',
      why: 'stillPending',
      text: '',
      askAgain: true,
      shows: null,
    }),
    true,
  );
  let over = false;
  const asked = askAgain(OFF).then(() => {
    over = true;
  });
  await answered();
  expect(over).toBe(false);
  expect(checking(OFF)).toBe(true);
  heardJob(job(OFF, 'merge', { kind: 'pending', trouble: null }), true);
  await asked;
  expect(checking(OFF)).toBe(false);
  expect(merging.getState().jobs.get(pull)?.state.kind).toBe('pending');
});

test('asking again by a read of the pull request is the button’s own again as the answer comes', async () => {
  heardJob(
    job(OFF, 'merge', { kind: 'unknown', why: 'noAnswer', text: '', askAgain: false, shows: null }),
    true,
  );
  asks = false;
  await askAgain(OFF);
  expect(checking(OFF)).toBe(false);
});
