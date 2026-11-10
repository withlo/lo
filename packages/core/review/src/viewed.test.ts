import { GithubError, type FileViewedState, type GraphQLError } from '@lo/github';
import { expect, test } from 'vitest';

import { changedSinceViewed, ViewedMarks, writeFailed, type ViewedToggle } from './viewed.ts';

function marks(entries: [string, FileViewedState][]): Map<string, FileViewedState> {
  return new Map(entries);
}

function github(entries: [string, FileViewedState][]): ViewedMarks {
  const viewed = new ViewedMarks();
  viewed.setGithub(marks(entries));
  return viewed;
}

/** `minute` minutes into a day in 2026, in milliseconds since the Unix epoch. */
function at(minute: number): number {
  return (1_790_000_000 + minute * 60) * 1000;
}

test('e marks a file viewed unless it is viewed', () => {
  const viewed = github([
    ['a', 'UNVIEWED'],
    ['b', 'DISMISSED'],
    ['c', 'VIEWED'],
  ]);

  const a = viewed.toggle('a');
  const b = viewed.toggle('b');
  const c = viewed.toggle('c');
  const unknown = viewed.toggle('d');

  expect([a.mark, b.mark, c.mark, unknown.mark]).toEqual([true, true, false, true]);
  // The new marks show at once.
  expect(viewed.shown()).toEqual(
    marks([
      ['a', 'VIEWED'],
      ['b', 'VIEWED'],
      ['c', 'UNVIEWED'],
      ['d', 'VIEWED'],
    ]),
  );
  expect(viewed.isPending('a')).toBe(true);
});

test('the viewed count counts the marks shown', () => {
  const viewed = github([
    ['a', 'UNVIEWED'],
    ['b', 'DISMISSED'],
    ['c', 'VIEWED'],
  ]);
  expect(viewed.viewedCount()).toEqual({ viewed: 1, files: 3 });
  // Marks being set count as they show, a file GitHub hasn't marked included.
  viewed.toggle('a');
  viewed.toggle('c');
  viewed.toggle('d');
  expect(viewed.viewedCount()).toEqual({ viewed: 2, files: 4 });
  expect(new ViewedMarks().viewedCount()).toEqual({ viewed: 0, files: 0 });
});

test('a finished write shows the new mark until github says otherwise', () => {
  const viewed = github([['a', 'UNVIEWED']]);
  const toggle = viewed.toggle('a');

  viewed.finish(toggle, true, at(0));

  expect(viewed.isPending('a')).toBe(false);
  expect(viewed.state('a')).toBe('VIEWED');
  // GitHub's next answer wins.
  expect(viewed.setGithub(marks([['a', 'DISMISSED']]))).toBe(true);
  expect(viewed.state('a')).toBe('DISMISSED');
});

test('a failed write shows githubs mark again', () => {
  const viewed = github([
    ['a', 'UNVIEWED'],
    ['b', 'VIEWED'],
  ]);
  const mark = viewed.toggle('a');
  const clear = viewed.toggle('b');

  viewed.finish(mark, false, at(0));
  viewed.finish(clear, false, at(0));

  expect(viewed.shown()).toEqual(
    marks([
      ['a', 'UNVIEWED'],
      ['b', 'VIEWED'],
    ]),
  );
  expect(viewed.isPending('a')).toBe(false);
});

test('a failed write reverts to githubs latest mark', () => {
  const viewed = github([['a', 'UNVIEWED']]);
  const toggle = viewed.toggle('a');
  // GitHub's marks change while the write is in flight: the pending mark still shows.
  viewed.setGithub(marks([['a', 'DISMISSED']]));
  expect(viewed.state('a')).toBe('VIEWED');

  viewed.finish(toggle, false, at(0));

  expect(viewed.state('a')).toBe('DISMISSED');
});

test('a write that finishes after a later toggle doesnt undo it', () => {
  const viewed = github([['a', 'UNVIEWED']]);
  const mark = viewed.toggle('a');
  const clear = viewed.toggle('a');
  expect(clear.mark).toBe(false);
  expect(viewed.state('a')).toBe('UNVIEWED');

  // The mark went through, then the clear failed: GitHub has the file viewed.
  viewed.finish(mark, true, at(0));
  // The clear is still in flight.
  expect(viewed.state('a')).toBe('UNVIEWED');
  viewed.finish(clear, false, at(0));
  expect(viewed.state('a')).toBe('VIEWED');
});

test('marks github read before a write finished dont undo it', () => {
  const viewed = github([
    ['a', 'UNVIEWED'],
    ['b', 'UNVIEWED'],
  ]);
  const toggle = viewed.toggle('a');
  viewed.finish(toggle, true, at(10));

  // Read before the write finished, as a tab switch hands back: a's mark there is stale.
  const stale = viewed.withoutStale(
    marks([
      ['a', 'UNVIEWED'],
      ['b', 'VIEWED'],
    ]),
    at(9),
  );
  expect(stale).toEqual(
    marks([
      ['a', 'VIEWED'],
      ['b', 'VIEWED'],
    ]),
  );
  expect(viewed.setGithub(stale)).toBe(true);
  expect(viewed.state('a')).toBe('VIEWED');

  // Read after it, GitHub's answer stands.
  const fresh = viewed.withoutStale(
    marks([
      ['a', 'DISMISSED'],
      ['b', 'VIEWED'],
    ]),
    at(11),
  );
  expect(fresh).toEqual(
    marks([
      ['a', 'DISMISSED'],
      ['b', 'VIEWED'],
    ]),
  );
});

test('a failed write doesnt make githubs marks stale', () => {
  const viewed = github([['a', 'UNVIEWED']]);
  const toggle = viewed.toggle('a');
  viewed.finish(toggle, false, at(10));

  expect(viewed.withoutStale(marks([['a', 'DISMISSED']]), at(9))).toEqual(
    marks([['a', 'DISMISSED']]),
  );
});

test('the same marks from github arent a change', () => {
  const viewed = github([['a', 'VIEWED']]);
  expect(viewed.setGithub(marks([['a', 'VIEWED']]))).toBe(false);
  expect(viewed.setGithub(marks([['a', 'UNVIEWED']]))).toBe(true);
});

test('a file is marked by the path github lists it at', () => {
  const viewed = github([
    ['a', 'UNVIEWED'],
    ['old', 'VIEWED'],
  ]);
  viewed.setListed(new Set(['a', 'old', 'unknown-state']), 'h1');

  expect(viewed.githubPath('a')).toBe('a');
  // GitHub may list a state Lo doesn't know.
  expect(viewed.githubPath('unknown-state')).toBe('unknown-state');
  // A rename GitHub lists by its old path.
  expect(viewed.githubPath('new', 'old')).toBe('old');
  // GitHub listed every file, and not this one.
  expect(viewed.githubPath('b')).toBeUndefined();
  expect(viewed.githubPath('b', 'c')).toBeUndefined();
});

test('while githubs list is partial any file may be on it', () => {
  const viewed = github([
    ['a', 'UNVIEWED'],
    ['old', 'VIEWED'],
  ]);
  viewed.setListed(undefined, 'h1');

  expect(viewed.githubPath('b')).toBe('b');
  expect(viewed.githubPath('new', 'old')).toBe('old');
});

// GitHub's list says which files it has only at the head it was read at.
test('githubs list holds at its own head', () => {
  const viewed = github([['a', 'UNVIEWED']]);
  expect(viewed.setListed(new Set(['a']), 'h1')).toBe(true);
  expect(viewed.lists('a', 'h1')).toBe(true);
  expect(viewed.lists('b', 'h1')).toBe(false);
  expect(viewed.lists('a', 'h2')).toBeUndefined();
  expect(viewed.lists('b', 'h2')).toBeUndefined();
  expect(viewed.setListed(new Set(['a']), 'h1')).toBe(false);
  // The head changed.
  expect(viewed.setListed(new Set(['a']), 'h2')).toBe(true);
  expect(viewed.lists('b', 'h2')).toBe(false);
});

function toggled(path: string, mark: boolean): ViewedToggle {
  return { path, mark, id: 1 };
}

function graphqlError(message: string, type: string): GithubError {
  const error: GraphQLError = { message, type, path: [] };
  return new GithubError({ kind: 'graphql', errors: [error] });
}

function rateLimited(secondary: boolean): GithubError {
  return new GithubError({
    kind: 'rateLimited',
    message: 'API rate limit exceeded',
    secondary,
    resource: 'graphql',
  });
}

test('the toast says what failed and why', () => {
  const marking = toggled('src/main.rs', true);
  const clearing = toggled('src/main.rs', false);
  const offline = new GithubError({ kind: 'network', failure: 'offline', message: 'offline' });
  const cases: [ViewedToggle, GithubError, string][] = [
    [
      marking,
      offline,
      "Couldn't mark src/main.rs viewed: Lo can't reach GitHub. It shows GitHub's mark again.",
    ],
    [
      clearing,
      offline,
      "Couldn't clear the viewed mark on src/main.rs: Lo can't reach GitHub. It shows GitHub's mark again.",
    ],
    [
      marking,
      rateLimited(false),
      "Couldn't mark src/main.rs viewed: rozed-bot has used up GitHub's rate limit. It shows GitHub's mark again.",
    ],
    [
      marking,
      rateLimited(true),
      "Couldn't mark src/main.rs viewed: GitHub asked Lo to slow down. It shows GitHub's mark again.",
    ],
    [
      marking,
      graphqlError('Resource not accessible by integration', 'FORBIDDEN'),
      "Couldn't mark src/main.rs viewed: rozed-bot isn't allowed to (Resource not accessible by integration). It shows GitHub's mark again.",
    ],
    [
      marking,
      graphqlError('Filepath must be part of pull request', 'UNPROCESSABLE'),
      "Couldn't mark src/main.rs viewed: GitHub doesn't list src/main.rs in this pull request (Filepath must be part of pull request). It shows GitHub's mark again.",
    ],
    [
      marking,
      new GithubError({ kind: 'unauthorized', message: 'Bad credentials' }),
      "Couldn't mark src/main.rs viewed: rozed-bot is signed out. It shows GitHub's mark again.",
    ],
  ];
  for (const [failed, error, expected] of cases) {
    expect(writeFailed(failed, 'rozed-bot', error)).toBe(expected);
  }
});

/** Revisions r1 to r3, with heads `a1` to `a3`. */
const LABELS = new Map([
  ['a1', 'r1'],
  ['a2', 'r2'],
  ['a3', 'r3'],
]);

function label(head: string): string | undefined {
  return LABELS.get(head);
}

test('a file that changed since it was viewed says since when', () => {
  // Viewed in r1, and reviewed in r2 since: what changed since r1.
  expect(
    changedSinceViewed('DISMISSED', { kind: 'sinceViewed', from: 'a1', to: 'a3' }, 'a1', label),
  ).toBe('Changed since you viewed it in r1.');
  // Without a usable record, viewed elsewhere or recorded at the latest revision: since the last
  // review, or with none, since it was viewed.
  expect(
    changedSinceViewed(
      'DISMISSED',
      { kind: 'sinceLastReview', from: 'a2', to: 'a3' },
      undefined,
      label,
    ),
  ).toBe('Changed since your last review in r2.');
  expect(changedSinceViewed('DISMISSED', { kind: 'full' }, 'a3', label)).toBe(
    'Changed since it was viewed.',
  );
  // A commit no revision has goes by its short SHA.
  expect(
    changedSinceViewed(
      'DISMISSED',
      { kind: 'sinceLastReview', from: 'c7f30e9b1a5d', to: 'a3' },
      'ffff',
      label,
    ),
  ).toBe('Changed since your last review in c7f30e9.');
});

test('the note names the revision the file was viewed in even when its gone', () => {
  // r2 was force-pushed away, so the comparison starts from r1.
  expect(
    changedSinceViewed('DISMISSED', { kind: 'sinceViewed', from: 'a1', to: 'a3' }, 'a2', label),
  ).toBe('Changed since you viewed it in r2.');
});

test('other files say nothing', () => {
  const comparison = { kind: 'sinceViewed', from: 'a1', to: 'a3' } as const;
  for (const state of [undefined, 'VIEWED', 'UNVIEWED'] as const) {
    expect(changedSinceViewed(state, comparison, 'a1', label)).toBeUndefined();
  }
  // Nor does a file changed since viewed that has no comparison.
  expect(changedSinceViewed('DISMISSED', undefined, 'a1', label)).toBeUndefined();
});
