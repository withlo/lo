// Why a chain can't be made a GitHub stack, in words: every reason the core gives, worded for the
// pull request asked about, over rozed-dev/e2e's recorded tree (#2 a → main, #3 b → a, #4 c → b,
// #5 e → b and #6 d → main holding c).

import type { Reason } from '@lo/stacks';
import { expect, it } from 'vitest';

import { E2E, forestOf, recorded } from './test/support.ts';
import { errorText, numbers, reasonsText, sentence } from './words.ts';

it('words every reason the core gives', async () => {
  const found = await recorded('stacks_e2e', E2E);
  const context = { number: 6, repository: 'e2e', forest: forestOf(found), list: found.list };
  const reasons: [Reason, string][] = [
    [
      { kind: 'incomplete', gaps: [{ kind: 'openPullRequests' }] },
      `Lo reads the 1,000 newest of e2e's ${found.list.totalCount.toLocaleString('en-US')} open PRs, so it can't be sure of this stack.`,
    ],
    [
      { kind: 'incomplete', gaps: [{ kind: 'mergedPullRequests' }] },
      "Some merged PRs weren't looked up yet, so Lo can't be sure of this stack.",
    ],
    [
      { kind: 'incomplete', gaps: [{ kind: 'rulesets', why: 'forbidden' }] },
      "Lo couldn't read e2e's rulesets, so it can't be sure of this stack.",
    ],
    [{ kind: 'notOpen' }, "#6 isn't open."],
    [{ kind: 'alreadyStacked', stack: 59 }, 'This is GitHub stack #59 already.'],
    [{ kind: 'noStacksApi' }, "GitHub's Stacks API isn't available for e2e."],
    [{ kind: 'tooShort' }, 'A GitHub stack needs two PRs.'],
    [
      { kind: 'stackGoesOn', stack: 59, past: 4 },
      'GitHub stack #59 goes on above #4 with other PRs, and a stack takes new PRs only at its top.',
    ],
    [
      { kind: 'fromFork', pr: 4 },
      '#4 comes from a fork, and a GitHub stack holds only PRs from e2e.',
    ],
    [{ kind: 'queued', pr: 4 }, '#4 is in a merge queue.'],
    [
      { kind: 'onTrunk', pr: 4, base: 'release' },
      '#4 merges into release, a long-lived branch, and Lo never moves a PR off one.',
    ],
    [
      { kind: 'inAnotherStack', pr: 4, stack: 61 },
      '#4 is in GitHub stack #61 already, and a PR can be in only one.',
    ],
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
