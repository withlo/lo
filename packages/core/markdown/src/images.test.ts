import { expect, test } from 'vitest';

import { imageAddress, imageSources, isImageAddress } from './images.ts';

test("images load only from GitHub's image hosts", () => {
  const kept = [
    'https://camo.githubusercontent.com/4d1c/68747470733a2f2f652e636f6d2f612e706e67',
    'https://private-user-images.githubusercontent.com/1/2-abc.png?jwt=x',
    'https://user-images.githubusercontent.com/1/2-abc.png',
    'https://github.com/user-attachments/assets/cbe34088-7125-49ac-b6ed-ce17762af48a',
    'HTTPS://CAMO.GITHUBUSERCONTENT.COM/a',
  ];
  expect(kept.filter((src) => !isImageAddress(src))).toEqual([]);
  const refused = [
    'https://example.com/a.png',
    'http://camo.githubusercontent.com/a',
    'https://camo.githubusercontent.com:443x/a',
    'https://camo.githubusercontent.com:8443/a',
    'https://camo.githubusercontent.com./a',
    'https://evil.camo.githubusercontent.com/a',
    'https://camo.githubusercontent.com.evil.example/a',
    'https://camo.githubusercontent.com@evil.example/a',
    'https://u:p@camo.githubusercontent.com/a',
    'https://raw.githubusercontent.com/o/r/main/a.png',
    'https://avatars.githubusercontent.com/u/1',
    'https://github.com/o/r/raw/main/a.png',
    'https://github.com/user-attachments/assets/',
    'https://github.com/user-attachments/assetsx/1',
    'https://github.com/user-attachments/assets/../../evil/a.png',
    'https://github.com/user-attachments/assets/%2e%2e/%2e%2e/evil/a.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'blob:https://github.com/1',
    'file:///etc/passwd',
    '//camo.githubusercontent.com/a',
    'a.png',
  ];
  expect(refused.filter((src) => isImageAddress(src))).toEqual([]);
});

test('an image address is normalized, and a relative one reads from its page', () => {
  expect(imageAddress('https://github.com/user-attachments/assets/a/../b')).toBe(
    'https://github.com/user-attachments/assets/b',
  );
  expect(imageAddress('//camo.githubusercontent.com/a', 'https://github.com/o/r/pull/1')).toBe(
    'https://camo.githubusercontent.com/a',
  );
  expect(imageAddress('a.png', 'https://github.com/o/r/pull/1')).toBe(undefined);
});

test('the host list is fixed', () => {
  expect(Object.isFrozen(imageSources)).toBe(true);
  expect(imageSources.every((source) => Object.isFrozen(source))).toBe(true);
});
