// @vitest-environment jsdom
// A term's row in a glossary: the term and its tags, its definition, its end controls, and what it
// holds expanded.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../../test/classes.ts';
import { terms, testCommands, type Ran } from '../../test/commands.ts';
import { cleanUp, click, focus, render, rerender } from '../../test/dom.ts';
import { holdRegistry } from '../commands/control.ts';
import { Registry } from '../commands/registry.ts';
import type { RowTarget } from '../commands/targets.ts';
import { TermByline } from './TermByline.tsx';
import { EARLIER_SHOWN, TermRow, type TermDetails, type TermEarlier } from './TermRow.tsx';

const BUCKET: RowTarget = { kind: 'row', row: 'bucket' };
const EXPAND = { command: 'terms.expand', target: BUCKET };

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let release: (() => void) | undefined;
afterEach(() => {
  cleanUp();
  release?.();
  release = undefined;
});

/** The registry, with Expand term named Collapse term while `expanded()` says so. */
function held(expanded: () => boolean = () => false): Ran[] {
  const ran: Ran[] = [];
  const commands = testCommands(ran, [terms]).map((command) =>
    command.id === 'terms.expand' && command.handler !== undefined
      ? {
          ...command,
          handler: {
            ...command.handler,
            labelled: () => (expanded() ? 'Collapse term' : undefined),
          },
        }
      : command,
  );
  release = holdRegistry(new Registry({ system: 'mac', commands }));
  return ran;
}

const byline = (when: string) => (
  <TermByline by={{ login: 'ravi-k' }} written="agent" pull={{ number: 264 }} when={when} />
);

function earlier(count: number): TermEarlier[] {
  return Array.from({ length: count }, (_, at) => ({
    key: `e${at}`,
    definition: `Definition ${at}`,
    byline: byline(`${at + 1} d ago`),
  }));
}

describe('TermRow', () => {
  it('draws the term, its tags, its definition and the one it replaces', () => {
    held();
    const host = render(
      <TermRow
        term="bucket"
        marks={{ mark: 'changed', locked: true, suggestions: 2 }}
        definition="A token pool."
        before="A queue."
        expand={EXPAND}
        menu
        termId="term"
        definitionId="definition"
      />,
    );
    const row = host.querySelector<HTMLElement>('[data-lo-term-row]')!;
    expect(row.hasAttribute('data-key-scope')).toBe(true);
    const term = row.querySelector<HTMLElement>('.lo-term-row__term')!;
    expect(term.id).toBe('term');
    expect(term.textContent).toBe('bucket');
    expect(term.tabIndex).toBe(-1);
    // `⏎` on the term expands the row, so it says whether the row is expanded.
    expect(term.getAttribute('role')).toBe('button');
    expect(term.getAttribute('aria-expanded')).toBe('false');
    expect(term.hasAttribute('aria-controls')).toBe(false);
    expect(row.querySelector('.lo-term-row__head')?.textContent).toBe(
      'bucketChangedLocked2 suggestions',
    );
    const definition = row.querySelector('.lo-term-row__definition')!;
    expect(definition.id).toBe('definition');
    expect(definition.textContent).toBe('A token pool.Before A queue.');
    const buttons = [...row.querySelectorAll<HTMLButtonElement>('.lo-term-row__end button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'More actions for bucket',
      'Expand term',
    ]);
    for (const button of buttons) expect(button.tabIndex).toBe(-1);
  });

  it('is a stop for Tab on its term, where it’s asked to be', () => {
    const host = render(<TermRow term="bucket" definition="A pool." stop />);
    const term = host.querySelector<HTMLElement>('.lo-term-row__term')!;
    expect(term.tabIndex).toBe(0);
    // A term that doesn't expand isn't a button.
    expect(term.hasAttribute('role')).toBe(false);
    expect(term.hasAttribute('aria-expanded')).toBe(false);
    expect(host.querySelector('.lo-term-row__head')?.textContent).toBe('bucket');
    expect(host.querySelector('.lo-term-row__end button')).toBeNull();
  });

  it('runs its chevron’s command on the term, and is named for what it does next', () => {
    let open = false;
    const ran = held(() => open);
    const details: TermDetails = { earlier: [] };
    const host = render(
      <TermRow term="bucket" definition="A pool." expand={EXPAND} details={details} />,
    );
    const chevron = () => host.querySelector<HTMLButtonElement>('.lo-term-row__end button')!;
    expect(chevron().getAttribute('aria-expanded')).toBe('false');
    click(chevron());
    expect(ran).toEqual([['terms.expand', BUCKET]]);
    open = true;
    rerender(
      host,
      <TermRow term="bucket" definition="A pool." expand={EXPAND} details={details} expanded />,
    );
    expect(chevron().getAttribute('aria-label')).toBe('Collapse term');
    expect(chevron().getAttribute('aria-expanded')).toBe('true');
    const shown = document.getElementById(chevron().getAttribute('aria-controls')!);
    expect(shown?.textContent).toContain('No earlier definitions');
    const term = host.querySelector('.lo-term-row__term')!;
    expect(term.getAttribute('aria-expanded')).toBe('true');
    expect(term.getAttribute('aria-controls')).toBe(chevron().getAttribute('aria-controls'));
  });

  it('runs its chevron’s command on a click on its term, but not one ending a drag across its words', () => {
    const ran = held();
    const host = render(<TermRow term="bucket" definition="A pool." expand={EXPAND} />);
    const term = host.querySelector<HTMLElement>('.lo-term-row__term')!;
    click(term);
    expect(ran).toEqual([['terms.expand', BUCKET]]);
    const range = document.createRange();
    range.selectNodeContents(term);
    document.getSelection()?.addRange(range);
    click(term);
    expect(ran).toHaveLength(1);
    document.getSelection()?.removeAllRanges();
    // A term that doesn't expand takes no click.
    const plain = render(<TermRow term="cost" definition="A charge." />);
    click(plain.querySelector('.lo-term-row__term')!);
    expect(ran).toHaveLength(1);
  });

  it('holds its byline, lock, other names, suggestions and history, expanded', () => {
    held();
    const host = render(
      <TermRow
        term="bucket"
        definition="A pool."
        expand={EXPAND}
        expanded
        details={{
          byline: byline('3 d ago'),
          locked: { by: 'elle-kzn', when: '2 d ago' },
          aliases: ['buckets', 'token bucket'],
          suggestions: [
            {
              key: 's1',
              definition: 'A pool that refills.',
              byline: byline('1 h ago'),
              accept: { command: 'terms.accept', target: BUCKET },
              dismiss: { command: 'terms.dismiss', target: BUCKET },
              busy: 'accept',
            },
          ],
          earlier: earlier(1),
        }}
      />,
    );
    const definition = host.querySelector('.lo-term-row__definition')!;
    expect(definition.textContent).toContain('Locked by elle-kzn · 2 d ago');
    expect(definition.textContent).toContain('Also written as buckets, token bucket');
    const parts = [...definition.querySelectorAll('[role="group"]')];
    expect(parts.map((part) => part.getAttribute('aria-labelledby') !== null)).toEqual([
      true,
      true,
    ]);
    expect(parts.map((part) => part.firstElementChild?.textContent)).toEqual([
      'Suggestions',
      'History',
    ]);
    const [link, accept, dismiss] = parts[0]!.querySelectorAll('button');
    expect(link?.textContent).toBe('#264');
    expect(accept?.getAttribute('aria-busy')).toBe('true');
    expect(accept?.textContent).toContain('Accepting…');
    expect(dismiss?.hasAttribute('aria-busy')).toBe(false);
    expect(dismiss?.textContent).toContain('Dismiss');
    expect(parts[1]?.textContent).toContain('Definition 0');
  });

  it('shows five earlier definitions, then the rest on asking, and says when there are no more', () => {
    held();
    const host = render(
      <TermRow
        term="bucket"
        definition="A pool."
        expanded
        details={{ earlier: earlier(EARLIER_SHOWN + 12), capped: true }}
      />,
    );
    const history = () => [...host.querySelectorAll('[role="group"]')].at(-1)!;
    expect(history().textContent).toContain('Definition 4');
    expect(history().textContent).not.toContain('Definition 5');
    expect(history().textContent).not.toContain('Earlier changes aren’t listed.');
    const more = [...history().querySelectorAll('button')].find(
      (button) => button.textContent === 'Show 12 more',
    )!;
    click(more);
    expect(history().textContent).toContain('Definition 16');
    expect(history().textContent).toContain('Earlier changes aren’t listed.');
  });

  it('gives focus in what it holds back to the term as it collapses', () => {
    held();
    const details: TermDetails = {
      suggestions: [
        {
          key: 's',
          definition: 'A pool that refills.',
          byline: byline('now'),
          accept: { command: 'terms.accept', target: BUCKET },
        },
      ],
      earlier: [],
    };
    const row = (expanded: boolean) => (
      <TermRow
        term="bucket"
        definition="A pool."
        expand={EXPAND}
        expanded={expanded}
        details={details}
        stop
      />
    );
    const host = render(row(true));
    const accept = [...host.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Accept'),
    )!;
    focus(accept);
    rerender(host, row(false));
    expect(document.activeElement).toBe(host.querySelector('.lo-term-row__term'));
  });

  it('hands focus from “Show 12 more” to the first earlier definition it shows', () => {
    held();
    const host = render(
      <TermRow term="bucket" definition="A pool." expanded details={{ earlier: earlier(9) }} />,
    );
    const more = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Show 4 more',
    )!;
    focus(more);
    click(more);
    expect(more.isConnected).toBe(false);
    expect(document.activeElement?.textContent).toMatch(/^Definition 5/);
  });

  it('puts “Stop ignoring” in its chevron’s place while it’s ignored', () => {
    held();
    const stopped = vi.fn<() => void>();
    const host = render(
      <TermRow
        term="bucket"
        definition="A pool."
        expand={EXPAND}
        ignored
        onStopIgnoring={stopped}
      />,
    );
    expect(host.querySelector('.lo-term-row__grid')?.classList).toContain('is-ignored');
    const buttons = [...host.querySelectorAll('.lo-term-row__end button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Stop ignoring']);
    click(buttons[0]!);
    expect(stopped).toHaveBeenCalledOnce();
  });

  it('draws a problem under the row, and tints the row a jump reached', () => {
    const host = render(
      <TermRow term="bucket" definition="A pool." problem="Couldn’t save" reached focused />,
    );
    expect(host.querySelector('.lo-term-row__problem')?.textContent).toBe('Couldn’t save');
    expect(host.querySelector('.lo-term-row__grid')?.classList).toContain('is-target');
    expect(host.querySelector('[data-lo-term-row]')?.hasAttribute('data-focused')).toBe(true);
  });

  it('only uses utilities that Lo’s stylesheet has, so nothing is silently dropped', async () => {
    held();
    const host = render(
      <TermRow
        term="bucket"
        marks={{ mark: 'new' }}
        definition="A pool."
        expand={EXPAND}
        menu
        expanded
        focused
        details={{
          byline: byline('now'),
          locked: { by: 'elle-kzn', when: 'now' },
          aliases: ['buckets'],
          suggestions: [
            { key: 's', definition: 'x', byline: byline('now'), accept: EXPAND, dismiss: EXPAND },
          ],
          earlier: earlier(EARLIER_SHOWN + 1),
        }}
      />,
    );
    const empty = render(<TermRow term="b" definition="c" expanded details={{ earlier: [] }} />);
    const ignored = render(<TermRow term="b" definition="c" ignored />);
    expect(await missingRules(host)).toEqual([]);
    expect(await missingRules(empty)).toEqual([]);
    expect(await missingRules(ignored)).toEqual([]);
  });
});
