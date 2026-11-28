// @vitest-environment jsdom
// The name a commit gives its author: plain, quoted and cut short, so it can pass for no login.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanUp, render } from '../test/dom.ts';
import { COMMIT_NAME_SHOWN, CommitName, plainName } from './CommitName.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

describe('plainName', () => {
  it('takes out quotes and dots that could pass for Lo’s, and keeps an apostrophe in a word', () => {
    expect(plainName('“Ravi” · K')).toBe('Ravi K');
    expect(plainName("Sam O'Brien")).toBe("Sam O'Brien");
    expect(plainName(' "  " ')).toBe('');
  });
});

describe('CommitName', () => {
  it('quotes the name in curly quotes, plain and on one line', () => {
    const host = render(<CommitName name={'Ravi‮ K\n'} />);
    const name = host.querySelector('[data-lo-commit-name]')!;
    expect(name.textContent).toBe('“Ravi K”');
    expect(name.className).toBe('lo-ov-name');
  });

  it('cuts a long name short, with an ellipsis', () => {
    const host = render(<CommitName name={'a'.repeat(COMMIT_NAME_SHOWN + 6)} />);
    const drawn = host.querySelector('.lo-ov-name__text')!.textContent;
    expect(drawn).toBe(`${'a'.repeat(COMMIT_NAME_SHOWN - 1)}…`);
    const fits = render(<CommitName name={'b'.repeat(COMMIT_NAME_SHOWN)} />);
    expect(fits.querySelector('.lo-ov-name__text')!.textContent).toBe('b'.repeat(24));
  });
});
