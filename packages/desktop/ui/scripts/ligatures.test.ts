import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The base is named first: under jsdom, Vite rewrites `new URL('…', import.meta.url)` into an
// address on its dev server.
const here = import.meta.url;
const folder = (path: string) => fileURLToPath(new URL(path, here));

/** Every stylesheet a person writes: the design system's and ui's, without the generated ones. */
function stylesheets(): string[] {
  const generated = new Set(['tokens.css', 'type.css', 'theme.css']);
  const walk = (path: string): string[] =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(path, entry.name))
        : entry.name.endsWith('.css') && !generated.has(entry.name)
          ? [join(path, entry.name)]
          : [],
    );
  return [...walk(folder('../../../../design/css')), ...walk(folder('../src'))];
}

/** A declaration that sets the mono face: by its stack, or by a code type style, which names it. */
const MONO =
  /(?:^|[;{\s])font(?:-family)?:[^;{}]*var\(--(?:lo-font-mono|font-mono|fig-mono|lo-code-(?:text|small|key|display))\)/;

describe('code set as written', () => {
  it('turns ligatures off in every rule that sets the mono face', () => {
    // `font` puts ligatures back on whatever it's set on, so each rule says so itself, after it.
    const missing = stylesheets().flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(
          ([, , body = '']) => MONO.test(body) && !/font-variant-ligatures:\s*none/.test(body),
        )
        .map(([, selector = '']) => `${file}: ${selector.trim()}`),
    );
    expect(missing).toEqual([]);
  });
});
