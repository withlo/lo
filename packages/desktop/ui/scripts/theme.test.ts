import { describe, expect, it } from 'vitest';

import { theme } from './theme.ts';

const css = theme({
  color: { tokens: [{ name: 'lo-bg-chrome' }, { name: 'lo-fg-muted' }] },
  radius: { tokens: [{ name: 'lo-r-sm' }] },
  shadow: { tokens: [{ name: 'lo-shadow-pop' }] },
  spacing: { tokens: [{ name: 'lo-sp-4' }, { name: 'lo-sp-12' }] },
  size: { tokens: [{ name: 'lo-tabbar-h' }] },
  motion: { tokens: [{ name: 'lo-dur' }, { name: 'lo-dur-fast' }, { name: 'lo-ease-in' }] },
  type: {
    groups: [
      {
        styles: [
          { name: 'text-ui', fontWeight: 400 },
          { name: 'text-label', fontWeight: 600 },
          { name: 'code-text', fontWeight: 400 },
        ],
      },
    ],
  },
});

describe('theme', () => {
  it("switches off Tailwind's own theme", () => {
    expect(css).toContain('@theme inline {\n  --*: initial;\n  /*');
  });

  it('gives spacing a name per step and no base to multiply', () => {
    expect(css).toContain('  --spacing-4: var(--lo-sp-4);');
    expect(css).toContain('  --spacing-12: var(--lo-sp-12);');
    expect(css).not.toMatch(/--spacing:/);
  });

  it('maps each token onto its --lo-* variable, so themes still switch', () => {
    expect(css).toContain('  --color-bg-chrome: var(--lo-bg-chrome);');
    expect(css).toContain('  --color-fg-muted: var(--lo-fg-muted);');
    expect(css).toContain('  --radius-sm: var(--lo-r-sm);');
    expect(css).toContain('  --shadow-pop: var(--lo-shadow-pop);');
    expect(css).toContain('  --spacing-tabbar-h: var(--lo-tabbar-h);');
  });

  it('names the times and curves of motion, so a move is written with the tokens alone', () => {
    expect(css).toContain('  --transition-duration-base: var(--lo-dur);');
    expect(css).toContain('  --transition-duration-fast: var(--lo-dur-fast);');
    expect(css).toContain('  --ease-in: var(--lo-ease-in);');
  });

  it('names the weights the type styles use', () => {
    expect(css).toContain('  --font-weight-normal: 400;');
    expect(css).toContain('  --font-weight-semibold: 600;');
    expect(css).not.toContain('--font-weight-bold');
  });

  it('makes each type style a utility setting the whole font', () => {
    expect(css).toContain('@utility text-ui {\n  font: var(--lo-text-ui);\n}');
    expect(css).toContain('@utility text-label {\n  font: var(--lo-text-label);\n}');
  });

  it('sets code as written: a code style turns ligatures off, after the font that turns them on', () => {
    expect(css).toContain(
      '@utility code-text {\n  font: var(--lo-code-text);\n  font-variant-ligatures: none;\n}',
    );
  });

  it("leaves the design system's own font stacks alone", () => {
    expect(css).not.toMatch(/--font-(?:ui|mono):/);
    expect(css).toContain('  --font-sans: var(--lo-font-ui);');
  });
});
