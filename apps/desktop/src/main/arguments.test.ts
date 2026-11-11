import { describe, expect, it } from 'vitest';

import { refusedArguments } from './arguments.ts';

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
