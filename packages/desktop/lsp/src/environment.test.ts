import { expect, test } from 'vitest';

import { serverEnvironment } from './environment.ts';

const GIT = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.fsmonitor',
  GIT_CONFIG_VALUE_0: 'false',
};
const BASE = {
  home: '/lo/servers/home',
  roots: ['/lo/checkouts/pull-1/abc', '/private/lo/checkouts/pull-1/abc'],
  path: [],
  git: GIT,
};

test('a server gets only its home, its toolchain, git’s variables and its adapter’s', () => {
  const env = serverEnvironment({
    ...BASE,
    path: ['/opt/go/bin', '/usr/bin'],
    variables: { GOPROXY: 'off', GOFLAGS: '-mod=mod' },
  });
  expect(env).toEqual({
    ...GIT,
    GOPROXY: 'off',
    GOFLAGS: '-mod=mod',
    HOME: '/lo/servers/home',
    TMPDIR: '/lo/servers/home/tmp',
    PATH: '/opt/go/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
  });
  expect(serverEnvironment(BASE).PATH).toBe('/usr/bin:/bin');
});

test('nothing in the checkout goes on PATH, and no folder is relative or empty', () => {
  for (const folder of ['bin', '', '/a:/b']) {
    expect(() => serverEnvironment({ ...BASE, path: [folder] })).toThrow('an absolute path');
  }
  expect(() =>
    serverEnvironment({ ...BASE, path: ['/lo/checkouts/pull-1/abc/node_modules/.bin'] }),
  ).toThrow('outside its checkout');
  expect(() => serverEnvironment({ ...BASE, home: '/lo/checkouts/pull-1/abc/.home' })).toThrow(
    'outside its checkout',
  );
  expect(() => serverEnvironment({ ...BASE, home: 'home' })).toThrow('an absolute path');
  // The checkout as the system resolves it is the checkout too.
  expect(() =>
    serverEnvironment({ ...BASE, path: ['/private/lo/checkouts/pull-1/abc/bin'] }),
  ).toThrow('outside its checkout');
  // A folder whose name only starts with the checkout's is outside it.
  expect(serverEnvironment({ ...BASE, path: ['/lo/checkouts/pull-1/abc-tools'] }).PATH).toBe(
    '/lo/checkouts/pull-1/abc-tools:/usr/bin:/bin',
  );
});

test('no adapter gives a server a token, a proxy, the SSH agent or git’s settings', () => {
  for (const name of [
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'NPM_PASSWORD',
    'AWS_SECRET_ACCESS_KEY',
    'HTTPS_PROXY',
    'https_proxy',
    'ALL_PROXY',
    'SSH_AUTH_SOCK',
    'SSH_ASKPASS',
    'GIT_ASKPASS',
    'GIT_DIR',
    'HOME',
    'PATH',
    'TMPDIR',
    'NOT-A-NAME',
  ]) {
    expect(() => serverEnvironment({ ...BASE, variables: { [name]: 'x' } })).toThrow(
      `the variable ${name}`,
    );
  }
  expect(() => serverEnvironment({ ...BASE, git: {} })).toThrow('needs git’s variables');
  expect(() => serverEnvironment({ ...BASE, git: { HOME: '/elsewhere' } })).toThrow('GIT_*');
  expect(() => serverEnvironment({ ...BASE, variables: { GOPROXY: 'off\0on' } })).toThrow(
    'no value',
  );
});

test('no adapter loads code into a server or its shell unless it says it means to', () => {
  for (const name of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'ELECTRON_RUN_AS_NODE',
    'BASH_ENV',
    'ENV',
    'BASH_FUNC_ls%%',
    'PYTHONSTARTUP',
    'JAVA_TOOL_OPTIONS',
    'npm_config_script_shell',
  ]) {
    expect(() => serverEnvironment({ ...BASE, variables: { [name]: 'x' } })).toThrow(
      /may not be given the variable/,
    );
  }
  for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'npm_config__auth', 'NPM_TOKEN']) {
    expect(() => serverEnvironment({ ...BASE, variables: { [name]: 'x' } })).toThrow(
      `the variable ${name}`,
    );
  }
  expect(
    serverEnvironment({
      ...BASE,
      variables: { NODE_OPTIONS: '--max-old-space-size=2048' },
      allowed: ['NODE_OPTIONS'],
    }).NODE_OPTIONS,
  ).toBe('--max-old-space-size=2048');
  // Allowing a secret, a proxy or one of git's doesn't make it one an adapter may set.
  for (const name of ['GITHUB_TOKEN', 'HTTPS_PROXY', 'GIT_DIR', 'npm_config__auth', 'PATH']) {
    expect(() =>
      serverEnvironment({ ...BASE, variables: { [name]: 'x' }, allowed: [name] }),
    ).toThrow(`the variable ${name}`);
  }
});
