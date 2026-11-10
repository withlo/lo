// Writes src/theme.css, Lo's Tailwind theme, from design/tokens.json. Tailwind's own palette and
// sizes are switched off (`--*: initial`), so the only utilities are Lo's tokens, each reading its
// `--lo-*` variable, which keeps themes switching through `data-theme`.
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
  size: { tokens: Token[] };
  type: { groups: { styles: { name: string; fontWeight: number | string }[] }[] };
}

/** The foundation's variables, which design/css/foundation.css writes by hand. */
const foundation = [
  '  --shadow-ring: var(--lo-ring);',
  '  --shadow-ring-inset: var(--lo-ring-inset);',
  '  --ease-in: var(--lo-ease-in);',
  '  --ease-out: var(--lo-ease-out);',
  '  --ease-in-out: var(--lo-ease-in-out);',
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

export function theme(tokens: TokenFile): string {
  const styles = tokens.type.groups.flatMap((group) => group.styles);
  const usedWeights = [...new Set(styles.map((style) => String(style.fontWeight)))].toSorted();
  const lines = [
    '  --*: initial;',
    '  /* One spacing step is a pixel: p-8 is 8px. The sizes below are named. */',
    '  --spacing: 1px;',
    ...tokens.size.tokens.map(({ name }) => `  --spacing-${bare(name)}: var(--${name});`),
    ...tokens.color.tokens.map(({ name }) => `  --color-${bare(name)}: var(--${name});`),
    ...tokens.radius.tokens.map(({ name }) => `  --radius-${bare(name, 'lo-r-')}: var(--${name});`),
    ...tokens.shadow.tokens.map(
      ({ name }) => `  --shadow-${bare(name, 'lo-shadow-')}: var(--${name});`,
    ),
    ...usedWeights.map((weight) => `  --font-weight-${weights[weight] ?? weight}: ${weight};`),
    ...foundation,
  ];
  const type = styles.map(({ name }) => `@utility ${name} {\n  font: var(--lo-${name});\n}`);
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
