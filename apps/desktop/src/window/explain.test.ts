import { describe, expect, it } from 'vitest';

import { explain } from './explain.ts';

describe('explain', () => {
  it('words each cause as the guide does', () => {
    expect(explain({ kind: 'offline' })).toBe('Offline.');
    expect(explain({ kind: 'github' })).toBe('GitHub returned an error.');
    expect(explain({ kind: 'timeout' })).toBe('GitHub didn’t respond.');
    expect(explain({ kind: 'rateLimit', resets: null })).toBe('GitHub’s rate limit was reached.');
    expect(explain({ kind: 'signedOut', login: 'ravi-k' })).toBe('ravi-k is signed out.');
    expect(explain({ kind: 'sso', org: 'rozed-dev' })).toBe('rozed-dev requires single sign-on.');
    expect(explain({ kind: 'unapproved', org: 'rozed-dev' })).toBe('rozed-dev hasn’t approved Lo.');
  });

  it('says when the rate limit resets, as a time of day', () => {
    const resets = new Date(2026, 10, 22, 14, 5).getTime();
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      resets,
    );
    expect(explain({ kind: 'rateLimit', resets })).toBe(`GitHub’s rate limit resets at ${time}.`);
  });

  it('names where sign-ins are kept: the Keychain on macOS, the keyring on Linux', () => {
    expect(explain({ kind: 'unreadable', login: 'ravi-k' }, 'mac')).toBe(
      'ravi-k’s sign-in can’t be read from the Keychain.',
    );
    expect(explain({ kind: 'unreadable', login: 'ravi-k' }, 'linux')).toBe(
      'ravi-k’s sign-in can’t be read from the keyring.',
    );
  });

  it('gives no reason where none is known', () => {
    expect(explain({ kind: 'unknown' })).toBeUndefined();
  });
});
