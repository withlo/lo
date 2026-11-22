// Why something asked of GitHub failed, as the interface words each cause, with GitHub's own text
// only where the reason doesn't say why.

import { GithubError } from '@lo/github';
import { describe, expect, it } from 'vitest';

import { causeOf, clock, explained } from './causes.ts';

const ASKER = { login: 'ravi-k', owner: 'rozed-dev' };

describe('why something asked of GitHub failed', () => {
  it('is one reason for each cause, naming the account or the organization where it’s theirs', () => {
    const reason = (detail: ConstructorParameters<typeof GithubError>[0]) =>
      causeOf(new GithubError(detail), ASKER);
    expect(reason({ kind: 'unauthorized', message: 'Bad credentials' })).toBe(
      'ravi-k is signed out.',
    );
    expect(reason({ kind: 'network', failure: 'offline', message: 'ENOTFOUND' })).toBe('Offline.');
    expect(reason({ kind: 'network', failure: 'lost', message: 'ETIMEDOUT' })).toBe(
      'GitHub didn’t respond.',
    );
    expect(reason({ kind: 'network', failure: 'tunnel', message: '502' })).toBe(
      'The proxy couldn’t connect to GitHub.',
    );
    expect(reason({ kind: 'ssoRequired', message: 'SSO' })).toBe(
      'rozed-dev requires single sign-on.',
    );
    expect(reason({ kind: 'oauthAppRestricted', message: 'Restricted', org: 'acme' })).toBe(
      'acme hasn’t approved Lo.',
    );
    expect(reason({ kind: 'notFound', message: 'Not Found' })).toBe(
      'It doesn’t exist, or ravi-k can’t see it.',
    );
    expect(reason({ kind: 'rateLimited', message: 'limit', secondary: false })).toBe(
      'GitHub’s rate limit was reached.',
    );
    const reset = new Date(2026, 10, 22, 14, 5).getTime();
    expect(
      reason({ kind: 'rateLimited', message: 'limit', secondary: false, reset: reset / 1000 }),
    ).toBe('GitHub’s rate limit resets at 14:05.');
    expect(reason({ kind: 'api', status: 500, message: 'Server Error', errors: [] })).toBe(
      'GitHub returned an error.',
    );
    // Neither a certificate nor a proxy's refusal can be told apart from the other.
    expect(reason({ kind: 'network', failure: 'refused', message: 'refused' })).toBe('');
    expect(causeOf(new Error('Lo stopped'), ASKER)).toBe('');
  });

  it('keeps GitHub’s own text only where the reason doesn’t say why', () => {
    const failed = new GithubError({ kind: 'api', status: 422, message: 'Invalid', errors: [] });
    expect(explained(failed, ASKER)).toBe('GitHub returned an error. GitHub answered 422: Invalid');
    expect(explained(new Error('No token for ravi-k'), ASKER)).toBe('No token for ravi-k');
    expect(
      explained(
        new GithubError({ kind: 'network', failure: 'offline', message: 'ENOTFOUND' }),
        ASKER,
      ),
    ).toBe('Offline.');
  });

  it('writes a time of day as a clock does', () => {
    expect(clock(new Date(2026, 10, 22, 9, 3).getTime())).toBe('09:03');
  });
});
