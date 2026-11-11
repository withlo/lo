import { expect, test } from 'vitest';

import {
  Drafts,
  type Draft,
  type DraftKey,
  type DraftPullRequest,
  type DraftPlace,
  type ThreadDraftPlace,
} from './drafts.ts';

function pullRequest(number: number): DraftPullRequest {
  return { owner: 'acme', repo: 'shop', number };
}

function key(account: string, number: number, place: DraftPlace): DraftKey {
  return { account, pullRequest: pullRequest(number), place };
}

function onLine(line: number): DraftPlace {
  return {
    kind: 'thread',
    commit: 'a3',
    path: 'src/parse.rs',
    lines: { end: { side: 'RIGHT', number: line } },
  };
}

const SUMMARY: DraftPlace = { kind: 'summary' };
const CONVERSATION: DraftPlace = { kind: 'conversation' };
const REPLY: DraftPlace = { kind: 'reply', thread: 'PRRT_1' };

test('a draft is kept until it is posted', () => {
  const drafts = new Drafts();
  const at = key('alice', 7, onLine(12));

  expect(drafts.set(at, 'Off by')).toBe(true);
  expect(drafts.set(at, 'Off by one?')).toBe(true);
  expect(drafts.get(at)).toBe('Off by one?');

  expect(drafts.take(at)).toBe('Off by one?');
  expect(drafts.get(at)).toBeUndefined();
  expect(drafts.take(at)).toBeUndefined();
});

test('setting the same text changes nothing', () => {
  const drafts = new Drafts();
  const at = key('alice', 7, SUMMARY);
  drafts.set(at, 'Looks good.');

  expect(drafts.set(at, 'Looks good.')).toBe(false);
});

test('blank text removes the draft', () => {
  const drafts = new Drafts();
  const at = key('alice', 7, CONVERSATION);
  drafts.set(at, 'Thanks!');

  expect(drafts.set(at, ' \n')).toBe(true);
  expect(drafts.get(at)).toBeUndefined();
  expect(drafts.set(at, '')).toBe(false);
  expect(drafts.isEmpty()).toBe(true);
});

test('drafts are kept apart by account pull request and place', () => {
  const drafts = new Drafts();
  drafts.set(key('alice', 7, onLine(12)), "Alice's");
  drafts.set(key('bob', 7, onLine(12)), "Bob's");
  drafts.set(key('alice', 8, onLine(12)), 'On #8');
  drafts.set(key('alice', 7, onLine(13)), 'Line 13');
  drafts.set(key('alice', 7, REPLY), 'A reply');

  expect(drafts.size).toBe(5);
  expect(drafts.get(key('alice', 7, onLine(12)))).toBe("Alice's");
  expect(drafts.get(key('bob', 7, onLine(12)))).toBe("Bob's");
  expect(drafts.get(key('alice', 8, onLine(12)))).toBe('On #8');
});

test('it lists an accounts drafts on a pull request', () => {
  const drafts = new Drafts();
  drafts.set(key('alice', 7, onLine(13)), 'Line 13');
  drafts.set(key('bob', 7, onLine(12)), "Bob's");
  drafts.set(key('alice', 8, onLine(12)), 'On #8');
  drafts.set(key('alice', 7, SUMMARY), 'Summary');

  expect(drafts.on('alice', pullRequest(7))).toEqual([
    { place: onLine(13), text: 'Line 13' },
    { place: SUMMARY, text: 'Summary' },
  ]);
});

test('saved drafts restore without blank ones', () => {
  const drafts = Drafts.from([
    { key: key('alice', 7, SUMMARY), text: 'Summary' },
    { key: key('alice', 7, CONVERSATION), text: '  ' },
  ]);

  expect(drafts.entries()).toEqual([{ key: key('alice', 7, SUMMARY), text: 'Summary' }]);
});

test('owners repositories and logins ignore case', () => {
  // As GitHub's do: a pull request opened from a pasted link may spell them otherwise.
  const spelled = (account: string, owner: string, repo: string): DraftKey => ({
    account,
    pullRequest: { owner, repo, number: 7 },
    place: SUMMARY,
  });
  const drafts = new Drafts();
  drafts.set(spelled('Alice', 'Acme', 'Shop'), 'Looks good.');

  expect(drafts.get(spelled('alice', 'acme', 'shop'))).toBe('Looks good.');
  expect(drafts.set(spelled('ALICE', 'acme', 'SHOP'), 'Looks good.')).toBe(false);
  expect(drafts.set(spelled('alice', 'ACME', 'shop'), 'Ship it.')).toBe(true);
  expect(drafts.size).toBe(1);
  expect(drafts.on('aLiCe', spelled('', 'ACME', 'shop').pullRequest)).toEqual([
    { place: SUMMARY, text: 'Ship it.' },
  ]);
  expect(drafts.entries()).toEqual([{ key: spelled('alice', 'acme', 'shop'), text: 'Ship it.' }]);
  expect(drafts.take(spelled('Alice', 'Acme', 'Shop'))).toBe('Ship it.');

  const restored = Drafts.from([{ key: spelled('Alice', 'Acme', 'Shop'), text: 'Saved' }]);
  expect(restored.get(spelled('alice', 'acme', 'shop'))).toBe('Saved');
});

function on(commit: string, path: string, line?: number): ThreadDraftPlace {
  return {
    kind: 'thread',
    commit,
    path,
    lines: line === undefined ? undefined : { end: { side: 'RIGHT', number: line } },
  };
}

/** Where a place on r2 is on r3: four lines were added above line 10, and line 20 changed. */
function movedToR3(place: ThreadDraftPlace): DraftPlace | undefined {
  if (place.path === 'README.md' && place.lines === undefined) return on('a3', 'README.md');
  const line = place.lines?.end.number;
  if (line === 10) return on('a3', 'src/parse.rs', 14);
  if (line === 26) return on('a3', 'src/parse.rs', 30);
  return undefined;
}

test('new thread drafts on older revisions move to the latest or are stranded', () => {
  const drafts = new Drafts();
  const alice = (place: DraftPlace): DraftKey => key('alice', 7, place);
  drafts.set(alice(on('a1', 'README.md')), 'On the file');
  drafts.set(alice(on('a2', 'src/parse.rs', 10)), 'Moved');
  drafts.set(alice(on('a2', 'src/parse.rs', 20)), 'Changed');
  drafts.set(alice(on('a2', 'src/parse.rs', 26)), 'Taken');
  drafts.set(alice(on('a3', 'src/parse.rs', 30)), 'On the latest');
  // Not new threads on older revisions, or not Alice's on #7.
  drafts.set(alice(REPLY), 'A reply');
  drafts.set(key('bob', 7, on('a2', 'src/parse.rs', 10)), "Bob's");
  drafts.set(key('alice', 8, on('a2', 'src/parse.rs', 10)), 'On #8');

  const older = drafts.onOlderRevisions('alice', pullRequest(7), 'a3', movedToR3);

  expect(older.map((draft) => [draft.text, draft.onLatest])).toEqual([
    ['On the file', on('a3', 'README.md')],
    ['Moved', on('a3', 'src/parse.rs', 14)],
    // Its line changed: stranded.
    ['Changed', undefined],
    // The latest revision already has a draft there: stranded.
    ['Taken', undefined],
  ]);
  expect(older[1]?.key).toEqual(alice(on('a2', 'src/parse.rs', 10)));
});

test('two older drafts moving to one place strand the later one', () => {
  const drafts = new Drafts();
  drafts.set(key('alice', 7, on('a1', 'src/parse.rs', 10)), 'First');
  drafts.set(key('alice', 7, on('a2', 'src/parse.rs', 10)), 'Second');

  const older = drafts.onOlderRevisions('alice', pullRequest(7), 'a3', () =>
    on('a3', 'src/parse.rs', 14),
  );

  expect(older.map((draft) => [draft.text, draft.onLatest !== undefined])).toEqual([
    ['First', true],
    ['Second', false],
  ]);
});

test('a draft moved anywhere but a new thread on the latest is stranded', () => {
  const drafts = new Drafts();
  drafts.set(key('alice', 7, on('a2', 'src/parse.rs', 10)), 'Draft');

  const older = drafts.onOlderRevisions('alice', pullRequest(7), 'a3', () =>
    on('a2', 'src/parse.rs', 14),
  );

  expect(older[0]?.onLatest).toBeUndefined();
});

test('pruning removes new threads drafts on revisions that are gone', () => {
  const drafts = new Drafts();
  drafts.set(key('alice', 7, on('a1', 'src/parse.rs', 10)), 'Gone');
  drafts.set(key('bob', 7, on('a1', 'README.md')), "Bob's, gone");
  drafts.set(key('alice', 7, on('a2', 'src/parse.rs', 10)), 'Kept');
  drafts.set(key('alice', 7, SUMMARY), 'Summary');
  drafts.set(key('alice', 8, on('a1', 'src/parse.rs', 10)), 'On #8');

  // r1 was force-pushed away, and GitHub no longer has it.
  const removed = drafts.prune(pullRequest(7), (commit) => commit !== 'a1');

  expect(removed).toBe(2);
  expect(drafts.entries().map(({ text }) => text)).toEqual(['Kept', 'Summary', 'On #8']);
  expect(drafts.prune(pullRequest(7), (commit) => commit !== 'a1')).toBe(0);
});

test('a saved draft in a comment box lo doesnt know is kept as it was', () => {
  // Drafts a later version of Lo saved, two in a kind of comment box this one doesn't know, read
  // back as the app reads what it saved.
  const pinned = (note: string) => ({
    account: 'alice',
    pullRequest: pullRequest(7),
    place: { kind: 'pinned', note },
  });
  const saved: Draft[] = JSON.parse(
    JSON.stringify([
      { key: key('alice', 7, SUMMARY), text: 'Summary' },
      { key: pinned('N_1'), text: 'First' },
      { key: pinned('N_2'), text: 'Second' },
    ]),
  );
  const drafts = Drafts.from(saved);

  // Each is kept apart by all of its place, and saved again as it came.
  expect(drafts.size).toBe(3);
  expect(drafts.get(key('alice', 7, SUMMARY))).toBe('Summary');
  expect(drafts.entries()).toEqual(expect.arrayContaining(saved));
  for (const draft of saved) expect(drafts.get(draft.key)).toBe(draft.text);
  // It isn't a new thread, so it's never moved to another revision or pruned with one.
  expect(drafts.onOlderRevisions('alice', pullRequest(7), 'a9', () => undefined)).toEqual([]);
  expect(drafts.prune(pullRequest(7), () => false)).toBe(0);
  expect(drafts.size).toBe(3);
});
