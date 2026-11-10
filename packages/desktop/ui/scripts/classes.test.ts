import { describe, expect, it } from 'vitest';

import { allowed, findArbitrary } from './classes.ts';

const find = (source: string, file = 'sample.tsx') =>
  findArbitrary(file, source).map(({ line, className }) => `${line} ${className}`);

describe('findArbitrary', () => {
  it('finds arbitrary values, properties and variants in class strings', () => {
    expect(
      find(`
        const a = 'flex text-[11px] hover:bg-[#fff]';
        const b = <div className="[&_svg]:size-12 [mask-type:luminance]" />;
        const c = \`gap-2 \${x} data-[open=true]:p-4\`;
        const d = cva('p-[calc(100%-2px)]', { variants: { size: { sm: 'w-[3px]' } } });
      `),
    ).toEqual([
      '2 text-[11px]',
      '2 hover:bg-[#fff]',
      '3 [&_svg]:size-12',
      '3 [mask-type:luminance]',
      '4 data-[open=true]:p-4',
      '5 p-[calc(100%-2px)]',
      '5 w-[3px]',
    ]);
  });

  it('leaves classes from the theme alone, and code that only looks like brackets', () => {
    expect(
      find(`
        const ok = 'flex h-tabbar-h gap-2 bg-bg-chrome text-small hover:bg-hover *:p-4 !p-8';
        type Map = { [key: string]: number };
        const first = items[0];
        const message = 'See notes [1] and [2].';
      `),
    ).toEqual([]);
  });

  it('leaves text that holds brackets and parentheses but no class alone', () => {
    expect(
      find(`
        const address = 'http://[::1]:8080/path';
        const reference = '[1]: https://example.com';
        const slice = 'rows[0:2] and cells[a:b]';
        const call = 'calc(100% - 2px) rotate(-45deg) minmax(0, 1fr)';
        const glob = '../features/*/background/index.ts';
        const empty = 'fn-() and x-[]';
      `),
    ).toEqual([]);
  });

  describe('whatever comes before the value', () => {
    it.each([
      // An important marker, a universal-child variant, an arbitrary variant, and a CSS variable.
      '!p-[17px]',
      '*:p-[19px]',
      '[&>*]:p-[2px]',
      'p-(--lo-tabbar-h)',
      // The same behind other variants, after the value, and as a modifier.
      'hover:!p-[17px]',
      'p-[17px]!',
      '*:*:p-[19px]',
      'hover:[&>*]:p-[2px]',
      '[&>*]:[mask-type:luminance]',
      'focus-visible:p-(--lo-tabbar-h)',
      'bg-fg/[.5]',
      'text-ui/(--lh)',
      'group-[.is-open]:block',
      '@min-[400px]:block',
      '[@media(min-width:300px)]:block',
    ])('finds %s', (className) => {
      expect(find(`const a = 'flex ${className} gap-8';`)).toEqual([`1 ${className}`]);
    });

    it('finds a class in a template literal, on its own line', () => {
      expect(
        find(`
          const a = cva(\`
            flex gap-8
            !p-[17px] hover:p-4
            p-(--lo-tabbar-h)
          \`);
        `),
      ).toEqual(['4 !p-[17px]', '5 p-(--lo-tabbar-h)']);
    });
  });

  describe('in files that aren’t scripts', () => {
    it('finds a class in an html file', () => {
      expect(
        find('<div class="flex">\n  <p class="gap-8 p-[31px]">Hi</p>\n</div>', 'page.html'),
      ).toEqual(['2 p-[31px]']);
    });

    it.each([
      ['page.html', '<div class="[&>*]:p-4 flex">'],
      ['page.html', '<div class=p-[31px]>'],
      ['page.html', "<div class='!p-[17px]'>"],
      ['view.vue', '<div :class="`gap-8 p-(--lo-tabbar-h)`">'],
      ['view.svelte', '<div class="*:p-[19px]">'],
      ['notes.md', 'Use `text-[11px]` for small text.'],
      ['notes.mdx', '<Box className="w-[3px]" />'],
    ])('finds the class in %s: %s', (file, source) => {
      expect(find(source, file)).toHaveLength(1);
    });

    it('leaves theme classes and prose alone', () => {
      expect(
        find(
          '<div class="flex gap-8 hover:bg-hover">notes [1]: the list, items[0] and //[::1]:80</div>',
          'page.html',
        ),
      ).toEqual([]);
    });
  });

  describe('the allowlist', () => {
    it('has nothing allowed yet', () => {
      expect(allowed.size).toBe(0);
    });

    it('lets an allowed class through and still finds the rest', () => {
      const allow = new Map([['!p-[17px]', 'A third-party widget needs it.']]);
      const source = "const a = '!p-[17px] *:p-[19px]';";
      expect(findArbitrary('sample.tsx', source, allow).map(({ className }) => className)).toEqual([
        '*:p-[19px]',
      ]);
      expect(findArbitrary('page.html', '!p-[17px] *:p-[19px]', allow)).toHaveLength(1);
    });
  });
});
