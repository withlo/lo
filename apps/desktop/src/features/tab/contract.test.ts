import { describe, expect, it } from 'vitest';

import { choice, contract, opening } from './contract.ts';

describe("the tab feature's contract", () => {
  it('opens a pull request by an owner, repository and number GitHub allows, or Settings', () => {
    const fd = { kind: 'pull', owner: 'sharkdp', repo: 'fd', number: 2212 };
    expect(opening.parse(fd)).toEqual(fd);
    expect(opening.parse({ kind: 'settings' })).toEqual({ kind: 'settings' });
    const refused = [
      // Names that would leave the cache's folders, or that GitHub doesn't allow.
      { ...fd, repo: '..' },
      { ...fd, repo: 'fd/pull/1' },
      { ...fd, owner: '-sharkdp' },
      { ...fd, owner: 'shark dp' },
      // Numbers GitHub can't hold.
      { ...fd, number: 0 },
      { ...fd, number: 2 ** 31 },
      { ...fd, number: 1.5 },
      // Recent opens by itself, and nothing else is a kind.
      { kind: 'recent' },
      { kind: 'file' },
      // Keys it doesn't name.
      { ...fd, title: 'Honor explicit use-jemalloc requests' },
      { kind: 'settings', section: 'keys' },
    ];
    expect(refused.filter((input) => opening.safeParse(input).success)).toEqual([]);
  });

  it('shows a tab by its id, its place, the last or a step, one at a time', () => {
    for (const input of [{ id: 't1' }, { position: 1 }, { last: true }, { step: -1 }]) {
      expect(choice.parse(input)).toEqual(input);
    }
    const refused = [{ position: 0 }, { step: 2 }, { last: false }, { id: 't1', position: 1 }, {}];
    expect(refused.filter((input) => choice.safeParse(input).success)).toEqual([]);
  });

  it('closes a tab by its id, or the one on screen', () => {
    const { input } = contract.requests.close;
    expect(input.parse({})).toEqual({});
    expect(input.parse({ id: 't1' })).toEqual({ id: 't1' });
    expect(input.safeParse({ id: '' }).success).toBe(false);
  });
});
