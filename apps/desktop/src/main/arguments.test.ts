import { describe, expect, it } from 'vitest';

import { refusedArguments, refusedEnvironment } from './arguments.ts';

/** `hasSwitch` for a command line that holds these switches, as Chromium names them. */
const holding =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name);
const none = holding();

describe('refusedArguments', () => {
  it('takes every switch in an unpackaged build, which its tests start with some', () => {
    expect(
      refusedArguments({
        packaged: false,
        argv: ['--inspect=0', '--remote-debugging-port=0'],
        hasSwitch: holding('remote-debugging-port'),
      }),
    ).toEqual([]);
  });

  it('starts a packaged build with no arguments', () => {
    expect(refusedArguments({ packaged: true, argv: [], hasSwitch: none })).toEqual([]);
  });

  it('starts a packaged build with arguments that are not switches', () => {
    expect(
      refusedArguments({
        packaged: true,
        argv: ['lo://github.com/withlo/lo/pull/1', 'https://github.com/withlo/lo/pull/1', 'x.txt'],
        hasSwitch: none,
      }),
    ).toEqual([]);
  });

  it.each([
    '--remote-debugging-port=9222',
    '--remote-debugging-port',
    '--remote-debugging-pipe',
    '--ignore-certificate-errors',
    '--host-resolver-rules=MAP api.github.com 127.0.0.1:9443',
    '--proxy-server=127.0.0.1:9443',
    '--inspect=0',
    '--user-data-dir=/tmp/x',
    '--no-sandbox',
    '--made-up-by-a-future-chromium',
  ])('refuses %s in a packaged build, by its name', (argument) => {
    expect(refusedArguments({ packaged: true, argv: [argument], hasSwitch: none })).toEqual([
      argument.split('=')[0],
    ]);
  });

  it('refuses the single-dash form, and the dashes alone', () => {
    expect(
      refusedArguments({
        packaged: true,
        argv: ['-remote-debugging-port=0', '-', '--'],
        hasSwitch: none,
      }),
    ).toEqual(['-remote-debugging-port', '-', '--']);
  });

  it('refuses a switch after other arguments, and after a `--`', () => {
    expect(
      refusedArguments({
        packaged: true,
        argv: ['lo://x', '--', '--ignore-certificate-errors', 'y'],
        hasSwitch: none,
      }),
    ).toEqual(['--', '--ignore-certificate-errors']);
  });

  it("never repeats what an argument's value says", () => {
    const [name] = refusedArguments({
      packaged: true,
      argv: ['--host-resolver-rules=MAP * attacker.example'],
      hasSwitch: none,
    });
    expect(name).toBe('--host-resolver-rules');
  });

  it('refuses a dangerous switch Chromium holds that the arguments do not show', () => {
    expect(
      refusedArguments({
        packaged: true,
        argv: [],
        hasSwitch: holding('remote-debugging-pipe', 'ignore-certificate-errors'),
      }),
    ).toEqual(['--remote-debugging-pipe', '--ignore-certificate-errors']);
  });

  it('names a switch once, when both the arguments and Chromium show it', () => {
    expect(
      refusedArguments({
        packaged: true,
        argv: ['-remote-debugging-port=0'],
        hasSwitch: holding('remote-debugging-port'),
      }),
    ).toEqual(['-remote-debugging-port']);
  });
});

describe('refusedEnvironment', () => {
  /** An environment such as a person's usual one: a proxy, and a network's certificate authority. */
  const usual = {
    PATH: '/usr/bin:/bin',
    HOME: '/Users/me',
    HTTPS_PROXY: 'http://proxy.example:3128',
    NO_PROXY: 'localhost',
    SSL_CERT_FILE: '/etc/ssl/corporate.pem',
    SSL_CERT_DIR: '/etc/ssl/certs',
    CURL_CA_BUNDLE: '/etc/ssl/corporate.pem',
    NODE_EXTRA_CA_CERTS: '/etc/ssl/corporate.pem',
    NODE_TLS_REJECT_UNAUTHORIZED: '1',
  };

  it('starts a packaged build in a usual environment', () => {
    expect(refusedEnvironment({ packaged: true, env: usual })).toEqual([]);
  });

  it.each([
    ['SSLKEYLOGFILE', '/tmp/keys.log'],
    ['SSLKEYLOGFILE', ''],
    ['ELECTRON_ENABLE_LOGGING', '1'],
    ['ELECTRON_LOG_FILE', '/tmp/chromium.log'],
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
  ])('refuses %s=%j in a packaged build, by its name', (name, value) => {
    expect(refusedEnvironment({ packaged: true, env: { ...usual, [name]: value } })).toEqual([
      name,
    ]);
  });

  it('names each refused, and never repeats a value', () => {
    const refused = refusedEnvironment({
      packaged: true,
      env: { SSLKEYLOGFILE: '/tmp/secret-place', ELECTRON_ENABLE_LOGGING: 'file' },
    });
    expect(refused).toEqual(['SSLKEYLOGFILE', 'ELECTRON_ENABLE_LOGGING']);
    expect(refused.join(' ')).not.toContain('secret-place');
  });

  it('takes them all in an unpackaged build, which its tests and debugging use', () => {
    expect(
      refusedEnvironment({
        packaged: false,
        env: { SSLKEYLOGFILE: '/tmp/keys.log', ELECTRON_ENABLE_LOGGING: '1' },
      }),
    ).toEqual([]);
  });
});
