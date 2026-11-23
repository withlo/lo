import { describe, expect, it } from 'vitest';

import { explain, gitWords, REMEDY_LABELS, remedyOf, waitsOut } from './explain.ts';

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

describe('the causes beyond GitHub’s answer', () => {
  it('words a proxy, what can’t be seen, and work on this computer', () => {
    expect(explain({ kind: 'proxy', why: 'refused' })).toBe(
      'The proxy couldn’t connect to GitHub.',
    );
    expect(explain({ kind: 'proxy', why: 'signIn' })).toBe('The proxy requires a sign-in.');
    expect(explain({ kind: 'proxy', why: 'unsupported' })).toBe(
      'The proxy isn’t HTTP, HTTPS or SOCKS5.',
    );
    expect(explain({ kind: 'hidden', login: 'ravi-k' })).toBe(
      'It doesn’t exist, or ravi-k can’t see it.',
    );
    expect(explain({ kind: 'private', signedIn: false })).toBe(
      'It doesn’t exist, or it’s private.',
    );
    expect(explain({ kind: 'private', signedIn: true })).toBe(
      'It doesn’t exist, or none of your accounts can see it.',
    );
    expect(explain({ kind: 'certificate' })).toBe('GitHub’s certificate couldn’t be verified.');
    expect(explain({ kind: 'diskFull' })).toBe('The disk is full.');
    expect(explain({ kind: 'tooSlow' })).toBe('It took too long.');
    expect(explain({ kind: 'memory' })).toBe('It ran out of memory.');
  });

  it('offers no try again where waiting or a setting is the fix', () => {
    expect(waitsOut({ kind: 'rateLimit', resets: 1 })).toBe(true);
    expect(waitsOut({ kind: 'rateLimit', resets: null })).toBe(false);
    expect(waitsOut({ kind: 'proxy', why: 'signIn' })).toBe(true);
    expect(waitsOut({ kind: 'offline' })).toBe(false);
  });

  it('offers what follows from the cause: signing in, nothing while it waits, or trying again', () => {
    expect(remedyOf({ kind: 'rateLimit', resets: 1 })).toBe('none');
    expect(remedyOf({ kind: 'signedOut', login: 'rozed-bot' })).toBe('signInAgain');
    expect(remedyOf({ kind: 'hidden', login: 'rozed-bot' })).toBe('signIn');
    expect(remedyOf({ kind: 'private', signedIn: false })).toBe('signIn');
    expect(remedyOf({ kind: 'private', signedIn: true })).toBe('tryAgain');
    expect(remedyOf({ kind: 'github' })).toBe('tryAgain');
    expect(REMEDY_LABELS.signInAgain).toBe('Sign in again');
  });
});

describe('gitWords', () => {
  const mac = { commands: ['xcode-select --install'], page: null };
  it('words Git that can’t be found, used or is too old as the guide’s Error', () => {
    expect(gitWords({ status: 'missing', install: mac })).toEqual({
      title: 'Can’t find Git',
      commands: ['xcode-select --install'],
      page: undefined,
    });
    expect(
      gitWords({
        status: 'distrusted',
        program: '/opt/bin/git',
        why: 'folderWritable',
        details: '/opt/bin/git\nother users can change /opt/bin',
        install: mac,
      }),
    ).toMatchObject({ title: 'Can’t use Git', reason: 'Other users can change its folder.' });
    expect(
      gitWords({
        status: 'tooOld',
        program: '/usr/bin/git',
        version: '2.30.0',
        minimum: '2.41.0',
        check: 'version',
        install: { commands: ['brew install git'], page: null },
      }),
    ).toEqual({
      title: 'Can’t use Git 2.30.0',
      reason: 'Version 2.41.0 or newer is required.',
      commands: ['brew install git'],
      page: undefined,
      details: '/usr/bin/git',
    });
  });
});
