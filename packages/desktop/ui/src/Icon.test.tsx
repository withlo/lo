// @vitest-environment jsdom

import * as lucide from 'lucide';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Icon, iconElement, type IconSize } from './Icon.tsx';
import { ICONS, type IconName } from './icons.ts';

/** Lucide's name for its export: `arrow-big-up` is `ArrowBigUp`. */
function exportName(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

describe('icons', () => {
  it('lists each icon under the name Lucide gives it', () => {
    const misnamed = Object.entries(ICONS)
      .filter(([name, shapes]) => Reflect.get(lucide, exportName(name)) !== shapes)
      .map(([name]) => name);
    expect(misnamed).toEqual([]);
  });
});

describe('Icon', () => {
  it('draws the icon’s shapes on the 24 grid, at its size’s class, hidden from screen readers', () => {
    const drawn = renderToStaticMarkup(<Icon name="corner-down-left" size={12} />);
    expect(drawn).toBe(
      '<svg class="lo-i lo-i--xs" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M20 4v7a4 4 0 0 1-4 4H4"></path><path d="m9 10-5 5 5 5"></path></svg>',
    );
    const sizes: [IconSize, string][] = [
      [12, 'lo-i lo-i--xs'],
      [14, 'lo-i lo-i--sm'],
      [16, 'lo-i'],
      [24, 'lo-i lo-i--lg'],
    ];
    for (const [size, classes] of sizes) {
      expect(renderToStaticMarkup(<Icon name="check" size={size} />)).toContain(
        `class="${classes}"`,
      );
    }
  });

  it('is an image by its label when it has one, and takes more classes', () => {
    const drawn = renderToStaticMarkup(
      <Icon name="check" size={16} label="Done" className="text-success" />,
    );
    expect(drawn).toContain('class="lo-i text-success"');
    expect(drawn).toContain('role="img" aria-label="Done"');
    expect(drawn).not.toContain('aria-hidden');
  });

  it('faces the other way when mirrored', () => {
    const drawn = renderToStaticMarkup(<Icon name="delete" size={12} mirrored />);
    expect(drawn).toMatch(/<g transform="matrix\(-1 0 0 1 24 0\)"><path /);
  });
});

describe('iconElement', () => {
  it('makes the svg Icon draws', () => {
    const cases: [IconName, IconSize, Parameters<typeof iconElement>[2]][] = [
      ['ellipsis', 14, {}],
      ['check', 12, { label: 'Done', className: 'text-success' }],
      ['delete', 12, { mirrored: true }],
    ];
    for (const [name, size, options] of cases) {
      expect(iconElement(name, size, options).outerHTML).toBe(
        renderToStaticMarkup(<Icon name={name} size={size} {...options} />),
      );
    }
  });
});
