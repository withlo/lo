import { describe, expect, it } from 'vitest';

import {
  avatarImageAddress,
  isLogin,
  MAX_AVATAR,
  postImageAddress,
  readImageAddress,
} from './images.ts';

const ATTACHMENT =
  'https://github.com/user-attachments/assets/08c730b3-f0b0-4c7d-93a2-95f8d167d0d9';
const PRIVATE = 'https://private-user-images.githubusercontent.com/1/2-a.png?jwt=eyJ.a.b';
const VIEW = '5b2a0f6e-0d4c-4d8e-9f3c-1d2e3f4a5b6c:84';

describe('image addresses', () => {
  it("names a post's image by its view and address, which read back as they were", () => {
    for (const address of [ATTACHMENT, PRIVATE, 'https://camo.githubusercontent.com/a/b#c']) {
      const built = postImageAddress(VIEW, address);
      expect(built).toMatch(/^lo-image:\/\/post\/[^/]+\/[^/?#]+$/);
      expect(readImageAddress(built ?? '')).toEqual({
        kind: 'post',
        view: VIEW,
        address: new URL(address).href,
      });
    }
  });

  it('names an avatar by its login and size, which read back as they were', () => {
    expect(avatarImageAddress('rozed-bot', 56)).toBe('lo-image://avatar/rozed-bot?s=56');
    expect(readImageAddress('lo-image://avatar/rozed-bot?s=56')).toEqual({
      kind: 'avatar',
      login: 'rozed-bot',
      size: 56,
    });
  });

  it.each([
    ['another host', 'https://example.com/a.png'],
    ['http', 'http://camo.githubusercontent.com/a'],
    ['another port', 'https://camo.githubusercontent.com:8443/a'],
    ['a user name', 'https://me@camo.githubusercontent.com/a'],
    ['data', 'data:image/png;base64,iVBORw0KGgo='],
    ['javascript', 'javascript:alert(1)'],
    ['github.com outside attachments', 'https://github.com/rozed-dev/e2e/raw/main/a.png'],
    ['the avatars host', 'https://avatars.githubusercontent.com/u/1'],
    ['the attachment store', 'https://github-production-user-asset-6210df.s3.amazonaws.com/a.png'],
  ])('makes no address for an image on %s, and reads none', (_what, address) => {
    expect(postImageAddress(VIEW, address)).toBeUndefined();
    const forged = `lo-image://post/${encodeURIComponent(VIEW)}/${encodeURIComponent(address)}`;
    expect(readImageAddress(forged)).toBeUndefined();
  });

  it('takes only a GitHub login, and a size GitHub serves', () => {
    for (const login of ['octocat', 'a', 'Mona-Lisa-1', 'x'.repeat(39)]) {
      expect(isLogin(login)).toBe(true);
    }
    for (const login of [
      '',
      'x'.repeat(40),
      'dependabot[bot]',
      'org/team',
      '../user',
      'a b',
      'é',
    ]) {
      expect(isLogin(login)).toBe(false);
      expect(avatarImageAddress(login, 56)).toBeUndefined();
    }
    for (const size of [0, -1, 1.5, MAX_AVATAR + 1, Number.NaN]) {
      expect(avatarImageAddress('octocat', size)).toBeUndefined();
    }
    expect(avatarImageAddress('octocat', MAX_AVATAR)).toBe(
      `lo-image://avatar/octocat?s=${MAX_AVATAR}`,
    );
  });

  it.each([
    'lo-image://avatar/dependabot%5Bbot%5D?s=56',
    'lo-image://avatar/..%2Fu%2F1?s=56',
    'lo-image://avatar/octocat/more?s=56',
    'lo-image://avatar/octocat',
    'lo-image://avatar/octocat?s=0',
    'lo-image://avatar/octocat?s=056',
    'lo-image://avatar/octocat?s=461',
    'lo-image://avatar/octocat?s=56&s=40',
    'lo-image://avatar/octocat?s=56&v=4',
    'lo-image://avatar/octocat?s=56#x',
    'lo-image://me@avatar/octocat?s=56',
    'lo-image://avatar:8080/octocat?s=56',
    'lo-image://elsewhere/octocat?s=56',
    `lo-image://post/${encodeURIComponent(VIEW)}`,
    `lo-image://post/${encodeURIComponent(VIEW)}/${encodeURIComponent(ATTACHMENT)}/more`,
    `lo-image://post/${encodeURIComponent(VIEW)}/${encodeURIComponent(ATTACHMENT)}?x=1`,
    `lo-image://post/a%20b/${encodeURIComponent(ATTACHMENT)}`,
    `lo-image://post/${encodeURIComponent(VIEW)}/%E0%A4%A`,
    `lo-app://post/${encodeURIComponent(VIEW)}/${encodeURIComponent(ATTACHMENT)}`,
    'not an address',
  ])('reads nothing from %s', (address) => {
    expect(readImageAddress(address)).toBeUndefined();
  });
});
