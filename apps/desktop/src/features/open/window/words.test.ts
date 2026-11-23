import { describe, expect, it } from 'vitest';

import { explain } from '../../../window/explain.ts';
import { blockedWords } from './words.ts';

const pull = { owner: 'rozed-dev', repo: 'e2e', number: 9999 };

describe('blockedWords', () => {
  it('says when GitHub’s rate limit resets, with nothing to press, however it stopped the box', () => {
    const resets = new Date(2026, 10, 22, 14, 5).getTime();
    const cause = { kind: 'rateLimit', resets } as const;
    const reason = explain(cause);
    expect(reason).toMatch(/^GitHub’s rate limit resets at /);
    expect(blockedWords({ kind: 'refused', cause, links: [], openAnyway: true }, pull)).toEqual({
      title: 'Can’t open rozed-dev/e2e#9999',
      reason,
      way: undefined,
    });
    expect(blockedWords({ kind: 'unchecked', cause }, pull)).toEqual({
      title: 'Couldn’t check rozed-dev/e2e#9999',
      reason,
      way: undefined,
    });
    // Any other cause GitHub didn't answer for leaves opening anyway.
    expect(blockedWords({ kind: 'unchecked', cause: { kind: 'github' } }, pull).way).toEqual({
      kind: 'openAnyway',
    });
  });

  it('names a pull request a repository doesn’t have by its number alone', () => {
    expect(blockedWords({ kind: 'missing' }, pull)).toEqual({
      title: 'Can’t open rozed-dev/e2e#9999',
      reason: 'rozed-dev/e2e has no #9999.',
      way: undefined,
    });
  });
});
