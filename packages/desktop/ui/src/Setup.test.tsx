import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button.tsx';
import { SetupItem, SetupList } from './Setup.tsx';

describe('SetupList', () => {
  it('is a labelled list of steps, one row each', () => {
    const html = renderToStaticMarkup(
      <SetupList label="Optional steps">
        <SetupItem icon={<svg />} title="Install the tool" description="Does a thing.">
          <Button size="sm">Install</Button>
        </SetupItem>
        <SetupItem icon={<svg />} title="Send links" description="Does another." />
      </SetupList>,
    );
    expect(html).toMatch(/^<ul aria-label="Optional steps"/);
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain('Install the tool');
    expect(html).toContain('Does a thing.');
    expect(html).toContain('<button type="button"');
  });

  it('hides a step’s icon from screen readers, and draws a button only when it has one', () => {
    const html = renderToStaticMarkup(
      <SetupItem icon={<svg />} title="Send links" description="Does another." />,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<button');
  });
});
