import { describe, expect, it } from 'vitest';

import { avatarImage, postImage } from './images.ts';

describe('avatarImage', () => {
  it("asks for a person's or an organization's avatar at twice the size it's drawn", () => {
    expect(avatarImage({ login: 'tess-okafor', type: 'User' }, 28)).toBe(
      'lo-image://avatar/tess-okafor?s=56',
    );
    expect(avatarImage({ login: 'rozed-dev', type: 'Organization' }, 20)).toBe(
      'lo-image://avatar/rozed-dev?s=40',
    );
  });

  it('leaves a bot, a team and any other account to its initials', () => {
    for (const type of ['Bot', 'Team', 'EnterpriseTeam', 'Mannequin', 'EnterpriseUserAccount']) {
      expect(avatarImage({ login: 'dependabot', type }, 28)).toBeUndefined();
    }
    expect(avatarImage({ login: 'not a login', type: 'User' }, 28)).toBeUndefined();
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
