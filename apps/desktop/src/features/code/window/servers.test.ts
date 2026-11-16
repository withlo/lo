// What a language server's status item shows, from what main said of it, and what copying its log
// takes.

import { describe, expect, it } from 'vitest';

import { describeServer } from './ServerList.tsx';
import { copiedLog, itemState } from './servers.ts';

describe('a language server’s status item', () => {
  it('shows main’s states, its memory cap in gigabytes', () => {
    expect(itemState({ kind: 'indexing', percent: 40 })).toEqual({ kind: 'indexing', percent: 40 });
    expect(itemState({ kind: 'notAnswering' })).toEqual({ kind: 'notAnswering' });
    expect(itemState({ kind: 'failed', why: { kind: 'memory', cap: 4 * 1024 ** 3 } })).toEqual({
      kind: 'failed',
      why: { kind: 'memory', limit: '4 GB' },
    });
    expect(
      itemState({ kind: 'failed', why: { kind: 'error', message: 'It quit with exit code 1.' } }),
    ).toEqual({ kind: 'failed', why: { kind: 'error', message: 'It quit with exit code 1.' } });
    const waits = { kind: 'license', server: 'Intelephense', license: 'the Intelephense Licence' };
    expect(
      itemState({ kind: 'license', server: 'Intelephense', license: 'the Intelephense Licence' }),
    ).toEqual(waits);
  });

  it('copies as much of the log as a copy holds, newest lines kept', () => {
    expect(copiedLog(['one', 'two'])).toBe('one\ntwo');
    const long = 'x'.repeat(600 * 1024);
    expect(copiedLog([long, long, 'last'])).toBe(`${long}\nlast`);
  });
});

describe('Settings’ list of language servers', () => {
  const PHP = {
    id: 'php',
    name: 'PHP',
    about: 'Intelephense 1.18.5 · proprietary',
    license: {
      server: 'intelephense',
      serverName: 'Intelephense',
      name: 'the Intelephense Licence',
      major: 1,
    },
  };

  it('says what each server is, and whether its license is accepted', () => {
    expect(
      describeServer({ id: 'typescript', name: 'TypeScript', about: 'vtsls 0.3.0 · MIT' }, false),
    ).toBe('vtsls 0.3.0 · MIT');
    expect(describeServer(PHP, false)).toBe(
      'Intelephense 1.18.5 · proprietary · Lo downloads it once you accept the Intelephense Licence',
    );
    expect(describeServer(PHP, true)).toBe(
      'Intelephense 1.18.5 · proprietary · you accepted the Intelephense Licence, for version 1',
    );
  });
});
