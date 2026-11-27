// @vitest-environment jsdom
// A path drawn whole: a box for each name and the slash after it, with a place to wrap between them.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanUp, render } from '../test/dom.ts';
import { WholePath } from './WholePath.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

describe('WholePath', () => {
  it('reads as the path, as code, and may wrap only after each slash', () => {
    const path = '~/Library/Application Support/Lo/cache/repos/github.com/rozed-dev/e2e.git';
    const host = render(<WholePath path={path} className="text-fg code-small" />);
    const code = host.querySelector('code');
    expect(code?.textContent).toBe(path);
    expect(code?.className).toBe('text-fg code-small');
    expect([...(code?.querySelectorAll('span') ?? [])].map((name) => name.textContent)).toEqual([
      '~/',
      'Library/',
      'Application Support/',
      'Lo/',
      'cache/',
      'repos/',
      'github.com/',
      'rozed-dev/',
      'e2e.git',
    ]);
    // Between the names, and nowhere else.
    expect(code?.querySelectorAll('wbr')).toHaveLength(8);
  });

  it('draws a path with no slash as one name', () => {
    const host = render(<WholePath path="keymap" />);
    expect(host.querySelectorAll('code span')).toHaveLength(1);
    expect(host.querySelector('wbr')).toBeNull();
  });
});
