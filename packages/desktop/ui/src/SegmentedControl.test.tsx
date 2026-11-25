import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SegmentedControl } from './SegmentedControl.tsx';

const ITEMS = [
  { value: 'tree', label: 'Tree' },
  { value: 'review', label: 'Review order' },
] as const;

function markup(disabled: boolean): string {
  return renderToStaticMarkup(
    <SegmentedControl
      label="File list"
      kind="views"
      size="sm"
      items={ITEMS}
      value="tree"
      onChange={() => {}}
      disabled={disabled}
      why="Reading files…"
    />,
  );
}

describe('SegmentedControl', () => {
  it('says why on each segment while it can’t be changed, and keeps the one chosen marked', () => {
    const segments = markup(true).split('<button').slice(1);
    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      expect(segment).toContain('aria-disabled="true"');
      expect(segment).toContain('aria-description="Reading files…"');
      expect(segment).not.toMatch(/\sdisabled=""/);
    }
    expect(segments[0]).toContain('aria-selected="true"');
    expect(segments[0]).toContain('tabindex="0"');
  });

  it('says no reason while it can be changed', () => {
    const html = markup(false);
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('aria-description');
  });
});
