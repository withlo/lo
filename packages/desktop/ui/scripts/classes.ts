// Finds Tailwind's arbitrary values (`text-[11px]`, `p-(--lo-tabbar-h)`, `[&_svg]:size-12`,
// `[mask-type:luminance]`) in source files, except for those in `allowed`. Lo's theme holds only
// its tokens, so a value outside them is a bracket away; check-classes.ts keeps it out.

import { resolve } from 'node:path';

import { Scanner } from '@tailwindcss/oxide';
import { parseSync } from 'oxc-parser';

/** Classes allowed anyway, each with the reason. None yet. */
export const allowed: ReadonlyMap<string, string> = new Map();

/**
 * Where an arbitrary value can sit in a class, whatever comes before it (`!p-[17px]`,
 * `*:p-[19px]`, `[&>*]:p-[2px]`, `hover:[mask-type:luminance]`):
 *
 * - a value after a dash, or after a word and a slash: `text-[11px]`, `p-(--lo-tabbar-h)`,
 *   `bg-fg/[.5]`;
 * - a property: `[mask-type:luminance]`;
 * - a variant: `[&_svg]:size-12`.
 *
 * A property or variant opens the class or follows a variant's colon, an `!` or some markup, but
 * never a word, bracket or slash, so code such as `items[0]` and addresses such as `//[::1]:8080`
 * don't match, and nor does prose such as `notes [1]`, since a class holds no space.
 */
const arbitrary = new RegExp(
  [
    String.raw`-\[[^\s\]]+\]|(?<=[\w\])])/\[[^\s\]]+\]`,
    String.raw`-\([^\s)]+\)|(?<=[\w\])])/\([^\s)]+\)`,
    String.raw`(?<![\w\])/])\[[a-z][\w-]*:[^\s\]]+\]`,
    String.raw`(?<![\w\])/])\[[^\s\]]+\]:\S`,
  ].join('|'),
);

/** The words of a text, which a class can't hold a space or, in markup, a quote or `<` inside. */
const words = /[^\s"'`<]+/g;

/** Source files whose strings are read as JavaScript, so only strings count, not code. */
const scripts = /\.[cm]?[jt]sx?$/;

/**
 * The files in a folder that Tailwind reads classes from: all but what it leaves out (what
 * `.gitignore` names, `node_modules`, binary files, lock files and stylesheets), whatever their
 * type, so a class in an `.html` file counts as much as one in a `.tsx`.
 */
export function sourceFiles(folder: string): string[] {
  const scanner = new Scanner({
    sources: [{ base: resolve(folder), pattern: '**/*', negated: false }],
  });
  // Tailwind lists stylesheets to watch them, but reads no classes from them.
  return scanner.files.filter((file) => !file.endsWith('.css')).toSorted();
}

export interface Finding {
  file: string;
  line: number;
  className: string;
}

/** Every string a file holds (literals and the text of template literals), with its line. */
function strings(file: string, source: string): { text: string; start: number }[] {
  const found: { text: string; start: number }[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const type: unknown = Reflect.get(node, 'type');
    const start: unknown = Reflect.get(node, 'start');
    const value: unknown = Reflect.get(node, 'value');
    if (type === 'Literal' && typeof value === 'string' && typeof start === 'number') {
      found.push({ text: value, start });
    }
    if (type === 'TemplateElement' && typeof start === 'number') {
      const cooked: unknown =
        typeof value === 'object' && value !== null ? Reflect.get(value, 'cooked') : null;
      if (typeof cooked === 'string') found.push({ text: cooked, start });
    }
    for (const key of Object.keys(node)) {
      if (key !== 'parent') visit(Reflect.get(node, key));
    }
  };
  visit(parseSync(file, source).program);
  return found;
}

/**
 * The arbitrary classes in one file's source. A script's strings are read, since a class can only
 * be one of them; any other file is read as text, as Tailwind does.
 */
export function findArbitrary(
  file: string,
  source: string,
  allow: ReadonlyMap<string, string> = allowed,
): Finding[] {
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length;
  const texts = scripts.test(file) ? strings(file, source) : [{ text: source, start: 0 }];
  return texts.flatMap(({ text, start }) =>
    [...text.matchAll(words)]
      .filter(([token]) => arbitrary.test(token) && !allow.has(token))
      .map((word) => ({ file, line: lineOf(start + word.index), className: word[0] })),
  );
}
