// Why a chain can't be converted to a GitHub stack, in words: every reason the core gives, worded for the
// pull request asked about, over rozed-dev/e2e's recorded tree (#2 a → main, #3 b → a, #4 c → b,
// #5 e → b and #6 d → main holding c).

import type { Plan, Reason } from '@lo/stacks';
import { expect, it } from 'vitest';

import { E2E, forestOf, recorded } from './test/support.ts';
import { GithubError } from '@lo/github';

import {
  calloutKind,
  calloutText,
  causeOf,
  errorText,
  numbers,
  reasonsText,
  sentence,
} from './words.ts';

it('words every reason the core gives', async () => {
  const found = await recorded('stacks_e2e', E2E);
  const context = { number: 6, repository: 'e2e', forest: forestOf(found), list: found.list };
  const reasons: [Reason, string][] = [
    [
      { kind: 'incomplete', gaps: [{ kind: 'openPullRequests' }] },
      'e2e has over 1,000 open pull requests',
    ],
    [
      { kind: 'incomplete', gaps: [{ kind: 'mergedPullRequests' }] },
      'Checking merged pull requests…',
    ],
    [
      { kind: 'incomplete', gaps: [{ kind: 'rulesets', why: 'forbidden' }] },
      'Couldn’t read e2e’s branch rules',
    ],
    [{ kind: 'notOpen' }, '#6 isn’t open'],
    [{ kind: 'alreadyStacked', stack: 59 }, 'Already a GitHub stack'],
    [{ kind: 'noStacksApi' }, 'GitHub stacks aren’t available for e2e'],
    [{ kind: 'tooShort' }, 'A GitHub stack needs 2 pull requests'],
    [{ kind: 'stackGoesOn', stack: 59, past: 4 }, 'The GitHub stack has other layers above #4'],
    [{ kind: 'fromFork', pr: 4 }, '#4 is from a fork'],
    [{ kind: 'queued', pr: 4 }, '#4 is in the merge queue'],
    [{ kind: 'onTrunk', pr: 4, base: 'release' }, '#4’s base branch is release'],
    [{ kind: 'inAnotherStack', pr: 4, stack: 61 }, '#4 is in another GitHub stack'],
  ];
  for (const [reason, words] of reasons) expect(reasonsText([reason], context)).toEqual([words]);
  // Each gap is a reason of its own, and reasons keep their order.
  expect(
    reasonsText(
      [
        { kind: 'noStacksApi' },
        {
          kind: 'incomplete',
          gaps: [{ kind: 'mergedPullRequests' }, { kind: 'rulesets', why: '' }],
        },
      ],
      context,
    ),
  ).toHaveLength(3);
});

it('names pull requests and errors as sentences do', () => {
  expect(numbers([])).toBe('');
  expect(numbers([4])).toBe('#4');
  expect(numbers([4, 6])).toBe('#4 and #6');
  expect(numbers([2, 4, 6])).toBe('#2, #4 and #6');
  expect(sentence("couldn't reach GitHub: offline")).toBe("Couldn't reach GitHub: offline.");
  expect(sentence('Done.')).toBe('Done.');
  expect(errorText(new Error('the request failed'))).toBe('The request failed.');
});

it('says why GitHub didn’t answer as every error does', () => {
  const offline = new GithubError({ kind: 'network', failure: 'offline', message: 'offline' });
  expect(causeOf(offline, 'octo').reason).toBe('Offline.');
  expect(causeOf(new Error('boom'), 'octo')).toEqual({ reason: null, details: 'Boom.' });
});

/** A plan over #2, #3 and #4 of `steps`. */
function plan(steps: Plan['steps']): Plan {
  return { root: 'main', path: [2, 3, 4], steps };
}

it('names which offer the stack’s tree makes of a plan, and says it: to convert a branch stack, or to add layers to the GitHub stack below them', () => {
  const convert = plan([{ kind: 'createStack', prs: [2, 3, 4] }]);
  const add = plan([{ kind: 'addToStack', stack: 59, prs: [4] }]);
  expect([calloutKind(convert), calloutText(convert)]).toEqual([
    'convert',
    'This branch stack merges one layer at a time.',
  ]);
  expect([calloutKind(add), calloutText(add)]).toEqual([
    'add',
    '#4 isn’t in the GitHub stack below it.',
  ]);
});
