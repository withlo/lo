import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildCss } from '../scripts/stylesheet.ts';
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

  it('takes its name from a heading, where one names it', () => {
    const html = renderToStaticMarkup(<SetupList labelledBy="tools" />);
    expect(html).toMatch(/^<ul aria-labelledby="tools"/);
    expect(html).not.toContain('aria-label=');
  });

  it('says a step is done where its button was', () => {
    const html = renderToStaticMarkup(
      <SetupItem icon={<svg />} title="Overview skill" description="Does a thing." done="Installed">
        <Button size="sm">Install</Button>
      </SetupItem>,
    );
    expect(html).toContain('Installed');
    expect(html).not.toContain('<button');
  });

  it('starts a row with no icon at its words, its control at the end', async () => {
    const html = renderToStaticMarkup(
      <SetupItem title="Show overviews" description="Turn off to take them out.">
        <Button size="sm">On</Button>
      </SetupItem>,
    );
    expect(html).not.toContain('aria-hidden');
    expect(html).toMatch(/<li class="[^"]*setup-item-plain/);
    expect(html.indexOf('Show overviews')).toBeLessThan(html.indexOf('<button'));
    const css = await buildCss(['setup-item-plain', 'col-start-1', 'col-start-2', 'col-span-2']);
    expect(css.replaceAll(/\s+/g, ' ')).toContain('grid-template-columns: minmax(0, 1fr) auto');
  });

  it('says what its last press left to say under its line, and keeps its state where it was', () => {
    const html = renderToStaticMarkup(
      <SetupItem
        icon={<svg />}
        title="lo command"
        description="Does a thing."
        done="Installed"
        below={<p>Add the folder to your PATH.</p>}
      />,
    );
    expect(html).toContain('Installed');
    expect(html).toContain('<p>Add the folder to your PATH.</p>');
    expect(html.indexOf('Does a thing.')).toBeLessThan(html.indexOf('Add the folder'));
  });

  it('hides a step’s icon from screen readers, and draws a button only when it has one', () => {
    const html = renderToStaticMarkup(
      <SetupItem icon={<svg />} title="Send links" description="Does another." />,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<button');
  });
});
