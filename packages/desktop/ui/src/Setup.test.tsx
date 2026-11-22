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

  it('takes its name from a heading, where one names it', () => {
    const html = renderToStaticMarkup(<SetupList labelledBy="tools" />);
    expect(html).toMatch(/^<ul aria-labelledby="tools"/);
    expect(html).not.toContain('aria-label=');
  });

  it('says a step is done where its button was, and draws its picture under its line', () => {
    const html = renderToStaticMarkup(
      <SetupItem
        icon={<svg />}
        title="Overview skill"
        description="Does a thing."
        done="Installed"
        figure={<img alt="An overview" />}
      >
        <Button size="sm">Install</Button>
      </SetupItem>,
    );
    expect(html).toContain('Installed');
    expect(html).not.toContain('<button');
    expect(html).toContain('<img alt="An overview"/>');
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
