// Finds Tailwind's bracketed arbitrary values (`text-[11px]`, `[&_svg]:size-12`, `bg-[#fff]`) in
// source files, except for those in `allowed`. Lo's theme holds only its tokens, so a value
// outside them is a bracket away; check-classes.ts keeps it out.

import { parseSync } from 'oxc-parser';

/** Bracketed classes allowed anyway, each with the reason. None yet. */
export const allowed: ReadonlyMap<string, string> = new Map();

/**
 * A class with an arbitrary value (`text-[11px]`), property (`[mask-type:luminance]`) or variant
 * (`[&_svg]:size-12`), after any variants. A class can't hold a space, so prose such as
 * `notes [1]` and TypeScript such as `[key: string]` never match.
 */
const arbitrary = /^(?:[\w-]*:)*(?:[\w-]+-\[[^\s\]]+\]|\[[a-z][\w-]*:[^\s\]]+\]|\[[^\s\]]+\]:)/;

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

/** The arbitrary classes in one file's source. */
export function findArbitrary(file: string, source: string): Finding[] {
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length;
  return strings(file, source).flatMap(({ text, start }) =>
    text
      .split(/\s+/)
      .filter((token) => arbitrary.test(token) && !allowed.has(token))
      .map((className) => ({ file, line: lineOf(start), className })),
  );
}
