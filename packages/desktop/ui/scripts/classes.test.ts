import { describe, expect, it } from 'vitest';

import { findArbitrary } from './classes.ts';

const find = (source: string) =>
  findArbitrary('sample.tsx', source).map(({ line, className }) => `${line} ${className}`);

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
        const ok = 'flex h-tabbar-h gap-2 bg-bg-chrome text-small hover:bg-hover';
        type Map = { [key: string]: number };
        const first = items[0];
        const message = 'See notes [1] and [2].';
      `),
    ).toEqual([]);
  });
});
