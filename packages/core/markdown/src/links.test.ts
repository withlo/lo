import { expect, test } from 'vitest';

import { fragmentName, isWebLink, webLink } from './links.ts';

test('only http and https links with a host are web links', () => {
  const web = ['https://github.com/sharkdp/fd', 'http://example.com', 'HTTPS://EXAMPLE.COM/a?b#c'];
  expect(web.filter((link) => !isWebLink(link))).toEqual([]);
  const others = [
    'file:///Applications/Calculator.app',
    'file://localhost/etc/hosts',
    'javascript:alert(1)',
    'ssh://example.com',
    'steam://run/1',
    'slack://open',
    'x-man-page://ls',
    'smb://server/share',
    'http://',
    '/etc/hosts',
    'example.com',
    // A user name or password, which can make a link read as another host.
    'https://github.com@evil.example/',
    'https://github.com:443@evil.example/octo/repo',
    'https://:pw@example.com/',
    'https://a:b@example.com/',
    'http://user@example.com/',
  ];
  expect(others.filter((link) => isWebLink(link))).toEqual([]);
});

test('a web link opens as parsed', () => {
  expect(webLink('HTTPS://Example.COM/a/../b?c#d')).toBe('https://example.com/b?c#d');
});

test('relative links read from the page they are on', () => {
  const page = 'https://github.com/octo/repo/pull/1#issuecomment-2';
  expect(webLink('../blob/main/a.rs', page)).toBe('https://github.com/octo/repo/blob/main/a.rs');
  expect(webLink('/octo/repo/issues', page)).toBe('https://github.com/octo/repo/issues');
  expect(webLink('//example.com/x', page)).toBe('https://example.com/x');
  expect(webLink('?q=1', page)).toBe('https://github.com/octo/repo/pull/1?q=1');
  // A relative link can't change the scheme, and a page that isn't one resolves nothing.
  expect(webLink('javascript:alert(1)', page)).toBe(undefined);
  expect(webLink('a', 'not a page')).toBe(undefined);
  expect(webLink('a', 'file:///etc/')).toBe(undefined);
});

test('schemes are read as a browser reads them, whatever their spelling', () => {
  const links = [
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0000javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:image/svg+xml;base64,PHN2Zz4=',
    'blob:https://github.com/1',
    'filesystem:https://github.com/temporary/x',
    'mailto:a@b.c',
    'tel:123',
  ];
  expect(
    links.filter((link) => webLink(link, 'https://github.com/o/r/pull/1') !== undefined),
  ).toEqual([]);
  // `&colon;` is no colon to `URL`, so that one is a harmless relative path on the page.
  expect(webLink('javascript&colon;alert(1)', 'https://github.com/o/r/pull/1')).toBe(
    'https://github.com/o/r/pull/javascript&colon;alert(1)',
  );
});

test('a lookalike host reads as punycode', () => {
  // Cyrillic letters and a Latin l, which reads as "paypal".
  expect(webLink('https://раураl.com/login')).toBe('https://xn--l-7sba6dbr.com/login');
  expect(webLink('https://ｇｉｔｈｕｂ.com/')).toBe('https://github.com/');
});

test('a fragment names an anchor, without GitHub’s prefix', () => {
  expect(fragmentName('#intro')).toBe('intro');
  expect(fragmentName('#user-content-intro')).toBe('intro');
  expect(fragmentName('#caf%C3%A9')).toBe('café');
  expect(fragmentName('#100%')).toBe('100%');
  expect(fragmentName('intro')).toBe(undefined);
});
