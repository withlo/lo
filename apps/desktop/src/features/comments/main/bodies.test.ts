import { GithubError, PullRef, type Poller, type RenderedBodies } from '@lo/github';
import { describe, expect, it, vi } from 'vitest';

import type { PullTabInfo } from '../../tab/service.ts';
import { readBodies } from './bodies.ts';

function info(change: Partial<PullTabInfo> = {}): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: 23,
    acting: { kind: 'account', login: 'rozed-bot' },
    head: { fork: null },
    shown: undefined,
    latest: undefined,
    provisional: false,
    local: { kind: 'waiting' },
    compareFrom: undefined,
    drawn: false,
    run: undefined,
    ...change,
  };
}

const READ: RenderedBodies = { description: '<p>Hi</p>', bodies: new Map(), gone: [] };

const readIt = () => Promise.resolve(READ);

function sourcesOf(tab: PullTabInfo | undefined, read: () => Promise<RenderedBodies>) {
  const renderedBodies = vi.fn<Poller['renderedBodies']>(read);
  const poller = vi.fn<(login: string) => Promise<{ renderedBodies: typeof renderedBodies }>>(() =>
    Promise.resolve({ renderedBodies }),
  );
  return { sources: { pull: () => tab, poller }, poller, renderedBodies };
}

/** Asks for the description on `tab`. */
function ask(tab: PullTabInfo | undefined) {
  return readBodies(sourcesOf(tab, readIt).sources, 't1', [], { description: true });
}

describe('readBodies', () => {
  it('reads the posts through the account’s poller', async () => {
    const { sources, poller, renderedBodies } = sourcesOf(info(), readIt);
    await expect(readBodies(sources, 't1', ['IC_1'], { description: true })).resolves.toBe(READ);
    expect(poller).toHaveBeenCalledWith('rozed-bot');
    expect(renderedBodies).toHaveBeenCalledWith(new PullRef('rozed-dev', 'e2e', 23), ['IC_1'], {
      description: true,
    });
  });

  it('refuses a tab that acts as nobody, a run, and no tab', async () => {
    await expect(ask(info({ acting: { kind: 'anonymous' } }))).rejects.toMatchObject({
      code: 'refused',
      message: 'Sign in to see comments.',
    });
    await expect(ask(info({ run: [23, 24] }))).rejects.toMatchObject({ code: 'refused' });
    await expect(ask(undefined)).rejects.toMatchObject({ code: 'missing' });
  });

  it('says what GitHub said when the read fails', async () => {
    const { sources } = sourcesOf(info(), () =>
      Promise.reject(new GithubError({ kind: 'notFound', message: 'Not Found' })),
    );
    await expect(readBodies(sources, 't1', ['IC_1'], { description: false })).rejects.toMatchObject(
      { code: 'failed', message: expect.stringContaining('Lo couldn’t read the comments') },
    );
  });
});
