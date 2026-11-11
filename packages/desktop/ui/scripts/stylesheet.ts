// Builds the CSS the window's stylesheet (src/styles.css) makes for some classes, so tests can
// check what Tailwind does with Lo's theme: which utilities exist, and what they set.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'tailwindcss';

// The base is named first: under jsdom, Vite rewrites `new URL('…', import.meta.url)` into an
// address on its dev server.
const here = import.meta.url;
const entry = fileURLToPath(new URL('../src/styles.css', here));

/** Finds what an `@import` names: a file beside the importer, or a package's. */
async function loadStylesheet(id: string, base: string) {
  const path = id.startsWith('.')
    ? resolve(base, id)
    : createRequire(resolve(base, 'file.js')).resolve(id);
  return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
}

/**
 * The CSS for these classes, and only these: a compiler remembers every class it's been asked
 * for, so each build starts a new one. A class Tailwind has no utility for adds nothing.
 */
export async function buildCss(classes: readonly string[]): Promise<string> {
  const compiler = await compile(readFileSync(entry, 'utf8'), {
    base: dirname(entry),
    loadStylesheet,
  });
  return compiler.build([...classes]);
}

/** A regular expression for a class's selector: `hover:bg-hover` is `.hover\:bg-hover` in CSS. */
function selector(className: string): string {
  const escaped = className.replace(/[^\w-]/g, (character) => `\\${character}`);
  return `.${escaped}`.replace(/[\\.]/g, '\\$&');
}

/** Whether the CSS has a rule for the class, under any variant it carries. */
export function hasRule(css: string, className: string): boolean {
  return new RegExp(`${selector(className)}(?![\\w-])`).test(css);
}

/** What a plain utility's rule sets, such as `padding: var(--lo-sp-4);`, or undefined without one. */
export function declarations(css: string, className: string): string | undefined {
  const rule = new RegExp(`${selector(className)} \\{([^{}]*)\\}`).exec(css);
  return rule?.[1]?.trim().replace(/\s+/g, ' ');
}
