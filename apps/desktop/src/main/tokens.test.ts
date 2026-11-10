import { describe, expect, it } from 'vitest';

import { readTokens, tokens } from './tokens.ts';

const made = readTokens({
  color: {
    tokens: [
      { name: 'ink', value: '#111111' },
      { name: 'chalk', value: '#eeeeee' },
      { name: 'ground', value: { dark: '#222222', light: '#dddddd' } },
      { name: 'mark', value: { dark: '{chalk}', light: '{ink}' } },
      { name: 'loop', value: '{loop}' },
    ],
  },
  size: {
    tokens: [
      { name: 'strip', value: '38px' },
      { name: 'code', value: '12.5px' },
      { name: 'ratio', value: '1.5' },
    ],
  },
});

describe('color', () => {
  it('reads a color in each theme', () => {
    expect(made.color('ground', 'dark')).toBe('#222222');
    expect(made.color('ground', 'light')).toBe('#dddddd');
    expect(made.color('ink', 'light')).toBe('#111111');
  });

  it('follows references to other tokens', () => {
    expect(made.color('mark', 'dark')).toBe('#eeeeee');
    expect(made.color('mark', 'light')).toBe('#111111');
  });

  it('throws for a missing or circular token', () => {
    expect(() => made.color('nothing', 'dark')).toThrow('nothing');
    expect(() => made.color('loop', 'dark')).toThrow('refers to itself');
  });
});

describe('size', () => {
  it('reads a size in pixels', () => {
    expect(made.size('strip')).toBe(38);
    expect(made.size('code')).toBe(12.5);
  });

  it('throws for a missing token or one not in pixels', () => {
    expect(() => made.size('nothing')).toThrow('nothing');
    expect(() => made.size('ratio')).toThrow('ratio');
  });
});

describe("Lo's tokens", () => {
  it('hold the values main reads', () => {
    for (const theme of ['dark', 'light'] as const) {
      for (const name of ['lo-bg', 'lo-fg-muted']) {
        expect(tokens.color(name, theme)).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    expect(tokens.size('lo-tabbar-h')).toBeGreaterThan(0);
  });
});
