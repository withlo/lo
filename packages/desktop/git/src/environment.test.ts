import { describe, expect, test } from 'vitest';

import { gitEnvironment, inheritedEnvironment, parseRemote } from './environment.ts';

test('inherits only path tmpdir and network variables', () => {
  const kept = {
    PATH: '/usr/bin:/bin',
    TMPDIR: '/tmp/x',
    DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
    SSL_CERT_FILE: '/etc/ca.pem',
    SSL_CERT_DIR: '/etc/ssl/certs',
    CURL_CA_BUNDLE: '/etc/ca-bundle.pem',
  };
  const dropped = {
    HOME: '/Users/someone',
    XDG_CONFIG_HOME: '/Users/someone/.config',
    GIT_DIR: '/elsewhere/.git',
    GIT_CONFIG_PARAMETERS: "'core.pager'='evil'",
    GIT_CONFIG_COUNT: '1',
    GIT_SSL_NO_VERIFY: '1',
    GIT_ASKPASS: '/tmp/steal',
    SSH_ASKPASS: '/tmp/steal',
    // Lo's own requests' proxy is the one a fetch gets.
    http_proxy: 'http://proxy:3128',
    https_proxy: 'http://proxy:3128',
    HTTPS_PROXY: 'http://proxy:3128',
    ALL_PROXY: 'socks5://proxy:1080',
    NO_PROXY: 'localhost',
    HTTP_PROXY: 'http://from-a-header',
    GITHUB_TOKEN: 'secret',
    LO_GITHUB_TOKEN: 'secret',
    LANG: 'fr_FR.UTF-8',
  };
  expect(inheritedEnvironment({ ...kept, ...dropped })).toEqual(kept);
});

describe('gitEnvironment', () => {
  const folders = { home: '/cache/home', ceiling: '/cache' };
  const remote = parseRemote('https://github.com');

  test('keeps a read from downloading, and gives it no token or proxy', () => {
    const env = gitEnvironment({ PATH: '/usr/bin' }, folders, remote, undefined);
    expect(env).toMatchObject({ GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: 'https' });
    expect(Object.keys(env).filter((name) => /token|proxy/i.test(name))).toEqual([]);
  });

  test('gives a fetch the token and the proxy', () => {
    const env = gitEnvironment({ PATH: '/usr/bin' }, folders, remote, {
      token: 'gho_secret',
      proxy: 'http://proxy:3128',
    });
    expect(env).toMatchObject({
      LO_GIT_TOKEN: 'gho_secret',
      http_proxy: 'http://proxy:3128',
      https_proxy: 'http://proxy:3128',
    });
    expect(env.GIT_NO_LAZY_FETCH).toBeUndefined();
  });
});

describe('parseRemote', () => {
  test('takes any https address, and for tests a server on this machine or a folder', () => {
    expect(parseRemote('https://github.com/')).toEqual({
      base: 'https://github.com',
      protocol: 'https',
      origin: 'https://github.com',
    });
    expect(parseRemote('http://127.0.0.1:8080').protocol).toBe('http');
    expect(parseRemote('http://localhost:8080').origin).toBe('http://localhost:8080');
    expect(parseRemote('file:///tmp/remotes')).toEqual({
      base: 'file:///tmp/remotes',
      protocol: 'file',
      origin: undefined,
    });
  });

  test.each([
    'http://github.com',
    'http://192.168.1.2:8080',
    'ssh://git@github.com/a/b.git',
    'git://github.com',
    'https://x-access-token:secret@github.com',
    'https://user@github.com',
    'https://github.com/?a=b',
    'github.com',
    '',
  ])('refuses %j', (base) => {
    expect(() => parseRemote(base)).toThrow("isn't a valid remote address");
  });

  test('never repeats a password it refuses', () => {
    expect(() => parseRemote('https://x-access-token:gho_secret@github.com')).toThrow(
      "`https://<redacted>@github.com` isn't a valid remote address",
    );
  });
});
