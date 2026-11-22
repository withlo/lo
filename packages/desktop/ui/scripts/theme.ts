// Writes src/theme.css, Lo's Tailwind theme, from design/tokens.json. Tailwind's own palette and
// sizes are switched off (`--*: initial`), so the only utilities are Lo's tokens, each reading its
// `--lo-*` variable, which keeps themes switching through `data-theme`. That includes spacing: a
// spacing utility takes one of the `lo-sp-*` steps or a named size, and nothing else.
//
//   pnpm nx run ui:codegen

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

interface Token {
  name: string;
}

export interface TokenFile {
  color: { tokens: Token[] };
  radius: { tokens: Token[] };
  shadow: { tokens: Token[] };
  spacing: { tokens: Token[] };
  size: { tokens: Token[] };
  motion: { tokens: Token[] };
  type: { groups: { styles: { name: string; fontWeight: number | string }[] }[] };
}

/** The foundation's variables, which design/css/foundation.css writes by hand. */
const foundation = [
  '  --shadow-ring: var(--lo-ring);',
  '  --shadow-ring-inset: var(--lo-ring-inset);',
  // A transition that names no duration or curve is a Tint: fast, and arriving.
  '  --default-transition-duration: var(--lo-dur-fast);',
  '  --default-transition-timing-function: var(--lo-ease-out);',
  // font-sans and font-code: the design system's own stacks are --font-ui and --font-mono, which
  // the theme mustn't redefine.
  '  --font-sans: var(--lo-font-ui);',
  '  --font-code: var(--lo-font-mono);',
];

const weights: Record<string, string> = {
  300: 'light',
  400: 'normal',
  500: 'medium',
  600: 'semibold',
  700: 'bold',
  800: 'extrabold',
};

/** `lo-bg-chrome` as Tailwind names it: `bg-chrome`. */
const bare = (name: string, prefix = 'lo-') => name.slice(prefix.length);

/**
 * A motion token as Tailwind's theme names it: a curve is `ease-out`, and a duration is
 * `duration-fast`, `duration-base` (`lo-dur`, which has no word of its own) or `duration-slow`.
 */
function motion(name: string): string {
  if (name.startsWith('lo-ease-')) return `  --ease-${bare(name, 'lo-ease-')}: var(--${name});`;
  if (name === 'lo-dur') return `  --transition-duration-base: var(--${name});`;
  if (name.startsWith('lo-dur-'))
    return `  --transition-duration-${bare(name, 'lo-dur-')}: var(--${name});`;
  throw new Error(`A motion token the theme has no name for: ${name}`);
}

export function theme(tokens: TokenFile): string {
  const styles = tokens.type.groups.flatMap((group) => group.styles);
  const usedWeights = [...new Set(styles.map((style) => String(style.fontWeight)))].toSorted();
  const lines = [
    '  --*: initial;',
    // There's no `--spacing` base. With one, Tailwind multiplies it by any number, and p-17 becomes
    // a utility.
    "  /* Spacing is the design system's steps, and its sizes by name: p-8 is 8px, h-tabbar-h is the",
    "     strip's height, and p-17 is nothing. Zero is no space, not a step: p-0, min-w-0. */",
    '  --spacing-0: 0px;',
    ...tokens.spacing.tokens.map(
      ({ name }) => `  --spacing-${bare(name, 'lo-sp-')}: var(--${name});`,
    ),
    ...tokens.size.tokens.map(({ name }) => `  --spacing-${bare(name)}: var(--${name});`),
    ...tokens.color.tokens.map(({ name }) => `  --color-${bare(name)}: var(--${name});`),
    ...tokens.radius.tokens.map(({ name }) => `  --radius-${bare(name, 'lo-r-')}: var(--${name});`),
    ...tokens.shadow.tokens.map(
      ({ name }) => `  --shadow-${bare(name, 'lo-shadow-')}: var(--${name});`,
    ),
    ...usedWeights.map((weight) => `  --font-weight-${weights[weight] ?? weight}: ${weight};`),
    ...tokens.motion.tokens.map(({ name }) => motion(name)),
    ...foundation,
  ];
  // Code is set as written. `font` puts ligatures back on, so a code style turns them off after it.
  const type = styles.map(({ name }) =>
    name.startsWith('code-')
      ? `@utility ${name} {\n  font: var(--lo-${name});\n  font-variant-ligatures: none;\n}`
      : `@utility ${name} {\n  font: var(--lo-${name});\n}`,
  );
  return [
    "/* Lo's Tailwind theme, generated from design/tokens.json by scripts/theme.ts. Don't edit it:",
    '   change the tokens and run `pnpm nx run ui:codegen`. */',
    '',
    `@theme inline {\n${lines.join('\n')}\n}`,
    '',
    '/* Type styles set the whole font shorthand, as the design system does: text-ui, read-body. */',
    type.join('\n\n'),
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = createRequire(import.meta.url).resolve('@lo/design/tokens.json');
  const tokens: TokenFile = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(new URL('../src/theme.css', import.meta.url), theme(tokens));
}
