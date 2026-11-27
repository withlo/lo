import { redrawPictures } from '@lo/ui';
import { describe, expect, it, vi } from 'vitest';

import { avatarImage, postImage, redrawBot } from './images.ts';

vi.mock('@lo/ui', () => ({
  redrawPictures: vi.fn<(change: (address: string) => string | undefined) => void>(),
}));

describe('avatarImage', () => {
  it("asks for a person's or an organization's avatar at twice the size it's drawn", () => {
    expect(avatarImage({ login: 'tess-okafor', type: 'User' }, 28)).toBe(
      'lo-image://avatar/tess-okafor?s=56',
    );
    expect(avatarImage({ login: 'rozed-dev', type: 'Organization' }, 20)).toBe(
      'lo-image://avatar/rozed-dev?s=40',
    );
  });

  it("asks for a bot's avatar by its app's slug, which main finds the picture of", () => {
    expect(avatarImage({ login: 'cursor', type: 'Bot' }, 28)).toBe('lo-image://bot/cursor?s=56');
    expect(avatarImage({ login: 'github-actions[bot]', type: 'Bot' }, 20)).toBe(
      'lo-image://bot/github-actions?s=40',
    );
  });

  it('leaves a team and any other account to its initials', () => {
    for (const type of ['Team', 'EnterpriseTeam', 'Mannequin', 'EnterpriseUserAccount', '']) {
      expect(avatarImage({ login: 'dependabot', type }, 28)).toBeUndefined();
    }
    expect(avatarImage({ login: 'not a login', type: 'User' }, 28)).toBeUndefined();
    expect(avatarImage({ login: 'not a login', type: 'Bot' }, 28)).toBeUndefined();
  });
});

describe('postImage', () => {
  it("loads an image on one of GitHub's image hosts through main, and nothing else", () => {
    expect(postImage('tab-1', 'https://camo.githubusercontent.com/a')).toBe(
      `lo-image://post/tab-1/${encodeURIComponent('https://camo.githubusercontent.com/a')}`,
    );
    expect(postImage('tab-1', 'https://example.com/a.png')).toBeUndefined();
  });
});

describe('redrawBot', () => {
  it("draws a bot's avatars again at every size, at a new address each time, and no one else's", () => {
    redrawBot('cursor');
    const [first] = vi.mocked(redrawPictures).mock.calls[0] ?? [];
    expect(first?.('lo-image://bot/cursor?s=56')).toBe('lo-image://bot/cursor?s=56&r=1');
    expect(first?.('lo-image://bot/Cursor?s=40')).toBe('lo-image://bot/Cursor?s=40&r=1');
    expect(first?.('lo-image://bot/cursor-two?s=56')).toBeUndefined();
    // A person may have the bot's slug as their login.
    expect(first?.('lo-image://avatar/cursor?s=56')).toBeUndefined();
    expect(first?.('not an address')).toBeUndefined();
    // An avatar drawn after has the new address too.
    expect(avatarImage({ login: 'cursor[bot]', type: 'Bot' }, 20)).toBe(
      'lo-image://bot/cursor?s=40&r=1',
    );
    redrawBot('cursor');
    const [second] = vi.mocked(redrawPictures).mock.calls[1] ?? [];
    expect(second?.('lo-image://bot/cursor?s=56&r=1')).toBe('lo-image://bot/cursor?s=56&r=2');
  });
});
