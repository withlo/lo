// The design system's tokens, for the few places main needs a value the window's CSS can't
// supply: the window's background before its page paints, and the colors and height of the
// system's window controls on Linux.

import design from '@lo/design/tokens.json';

export type Theme = 'dark' | 'light';

/** The parts of `tokens.json` read here. */
export interface TokenFile {
  color: { tokens: readonly { name: string; value: string | Readonly<Record<Theme, string>> }[] };
  size: { tokens: readonly { name: string; value: string }[] };
}

export interface Tokens {
  /** A color token's value in a theme, following references such as `{lo-chalk}`. */
  color(name: string, theme: Theme): string;
  /** A size token's value in pixels. */
  size(name: string): number;
}

export function readTokens(file: TokenFile): Tokens {
  const colors = new Map(file.color.tokens.map((token) => [token.name, token.value]));
  const sizes = new Map(file.size.tokens.map((token) => [token.name, token.value]));

  const color = (name: string, theme: Theme, seen: readonly string[] = []): string => {
    const value = colors.get(name);
    if (value === undefined) throw new Error(`There's no color token named ${name}.`);
    if (seen.includes(name)) throw new Error(`The color token ${name} refers to itself.`);
    const themed = typeof value === 'string' ? value : value[theme];
    const reference = /^\{(.+)\}$/.exec(themed)?.[1];
    return reference === undefined ? themed : color(reference, theme, [...seen, name]);
  };

  const size = (name: string): number => {
    const value = sizes.get(name);
    const pixels = value === undefined ? undefined : /^(\d+(?:\.\d+)?)px$/.exec(value)?.[1];
    if (pixels === undefined) throw new Error(`There's no size token in pixels named ${name}.`);
    return Number(pixels);
  };

  return { color: (name, theme) => color(name, theme), size };
}

/** Lo's tokens, from the design system. */
export const tokens = readTokens(design);
