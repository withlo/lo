#!/usr/bin/env node
// Builds Lo's CSS from design/tokens.json. No dependencies.
//
//   node design/scripts/build.mjs
//
// Writes:
//   design/css/tokens.css  colors per theme, shadows, spacing, radii, sizes, font stacks
//   design/css/type.css    one font shorthand per type style (--lo-text-ui …)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const write = (p, s) => {
  writeFileSync(join(root, p), s);
  console.log('wrote', p);
};

const t = JSON.parse(read('tokens.json'));
const themes = t.color.themes.map((x) => x.id);
const [first, ...rest] = themes;

const alias = (v) =>
  typeof v === 'string' && /^\{[^}]+\}$/.test(v) ? `var(--${v.slice(1, -1)})` : v;
const valueFor = (tok, theme) => {
  if (typeof tok.value === 'string') return theme === first ? tok.value : undefined;
  return tok.value[theme];
};
const isAlias = (tok) =>
  typeof tok.value === 'object' && Object.values(tok.value).some((v) => v.startsWith('{'));
const line = (name, value, usage) =>
  `  --${name}: ${alias(value)};${usage ? ` /* ${usage.replace(/\*\//g, '')} */` : ''}`;

const themed = [...t.color.tokens, ...(t.shadow?.tokens || [])];
let css = `/* ${t.name} — generated from tokens.json */\n`;
css += `/* Do not edit. Change design/tokens.json and run: node design/scripts/build.mjs */\n\n`;
css += `:root,\n[data-theme="${first}"] {\n${themed.map((tok) => line(tok.name, valueFor(tok, first), tok.usage)).join('\n')}\n}\n`;
for (const th of rest) {
  const lines = themed
    .filter((tok) => valueFor(tok, th) !== undefined || isAlias(tok))
    .map((tok) => line(tok.name, valueFor(tok, th) ?? valueFor(tok, first)));
  css += `\n[data-theme="${th}"] {\n${lines.join('\n')}\n}\n`;
}
const plain = [];
for (const [key, fam] of Object.entries(t)) {
  if (['name', 'version', 'meta', 'color', 'type', 'shadow'].includes(key) || !fam?.tokens)
    continue;
  plain.push(`  /* ${key} */`, ...fam.tokens.map((tok) => line(tok.name, tok.value, tok.usage)));
}
for (const [key, stack] of Object.entries(t.type.families))
  plain.push(`  --font-${key}: ${stack};`);
css += `\n:root {\n${plain.join('\n')}\n}\n`;
write('css/tokens.css', css);

// Font shorthands, one per type style: font: var(--lo-text-ui)
let type = `/* ${t.name} type — generated from tokens.json. Do not edit. */\n\n:root {\n`;
for (const g of t.type.groups) {
  type += `  /* ${g.name} */\n`;
  for (const s of g.styles) {
    type += `  --lo-${s.name}: ${s.fontWeight} ${s.fontSize}/${s.lineHeight} var(--lo-font-${s.family || g.family});${s.usage ? ` /* ${s.usage} */` : ''}\n`;
  }
}
type += '}\n';
write('css/type.css', type);
