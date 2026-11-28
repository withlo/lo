// @vitest-environment jsdom
// A term's card, its byline and its tags, as an overview's text and its Glossary section draw them.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../../test/classes.ts';
import { sections, terms, testCommands, type Ran } from '../../test/commands.ts';
import { cleanUp, click, render } from '../../test/dom.ts';
import { holdRegistry } from '../commands/control.ts';
import { Registry } from '../commands/registry.ts';
import type { RowTarget } from '../commands/targets.ts';
import { TermByline } from './TermByline.tsx';
import { TermCard } from './TermCard.tsx';
import { suggestionsCount, TermTags } from './TermTags.tsx';

const BUCKET: RowTarget = { kind: 'row', row: 'bucket' };

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let release: (() => void) | undefined;
afterEach(() => {
  cleanUp();
  release?.();
  release = undefined;
});

function held(): Ran[] {
  const ran: Ran[] = [];
  release = holdRegistry(
    new Registry({ system: 'mac', commands: testCommands(ran, [terms, sections]) }),
  );
  return ran;
}

/** Whether a mousedown on `element` would move focus to it. */
function takesFocus(element: Element): boolean {
  return element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}

describe('TermTags', () => {
  it('says New or Changed, then Locked, then how many suggestions', () => {
    const host = render(
      <div>
        <TermTags mark="changed" locked suggestions={2} />
      </div>,
    );
    expect([...host.firstElementChild!.children].map((tag) => tag.textContent)).toEqual([
      'Changed',
      'Locked',
      '2 suggestions',
    ]);
    expect(suggestionsCount(1)).toBe('1 suggestion');
    expect(suggestionsCount(1200)).toBe('1,200 suggestions');
  });
});

describe('TermByline', () => {
  it('names the account, how it was written, its pull request and when', () => {
    const opened = vi.fn<() => void>();
    const host = render(
      <TermByline
        by={{ login: 'ravi-k' }}
        written="agent"
        pull={{ number: 264, onOpen: opened }}
        when="3 d ago"
      />,
    );
    expect(host.textContent).toBe('RKravi-k · agent-written · #264 · 3 d ago');
    const link = host.querySelector('button')!;
    expect(link.textContent).toBe('#264');
    click(link);
    expect(opened).toHaveBeenCalledOnce();
  });

  it('quotes a name GitHub matched to no account, and says it’s not verified', () => {
    const host = render(<TermByline by={{ name: '“Ravi K”' }} written="human" when="2 h ago" />);
    expect(host.textContent).toBe('“Ravi K” · not verified · human-written · 2 h ago');
    expect(host.querySelector('[data-lo-commit-name]')).not.toBeNull();
    expect(host.querySelector('button')).toBeNull();
  });

  it('holds its place with a skeleton while the store is read', () => {
    const host = render(<TermByline reading />);
    expect(host.textContent).toBe('');
    expect(host.querySelector('.skeleton')?.classList).toContain('term-byline-wait');
  });

  it('keeps its link out of the tab order on a surface that takes no focus', () => {
    const host = render(
      <TermByline
        by={{ login: 'ravi-k' }}
        written="agent"
        pull={{ number: 264 }}
        when="now"
        focusable={false}
      />,
    );
    const link = host.querySelector('button')!;
    expect(link.tabIndex).toBe(-1);
    expect(takesFocus(link)).toBe(false);
  });
});

describe('TermCard', () => {
  it('draws every part, takes no focus, and is never heard', () => {
    const ran = held();
    const host = render(
      <TermCard
        term="bucket"
        marks={{ mark: 'changed', locked: true }}
        definition="A token pool that refills at a fixed rate."
        before="A queue of waiting requests."
        byline={<TermByline by={{ login: 'ravi-k' }} written="agent" when="3 d ago" />}
        suggestions={{ count: 2, command: 'terms.history', target: BUCKET }}
        hints={[
          { command: 'terms.edit', target: BUCKET, label: 'Edit…' },
          { command: 'terms.history', target: BUCKET, label: 'History' },
        ]}
        menu
      />,
    );
    const card = host.querySelector<HTMLElement>('.lo-hovercard')!;
    expect(card.getAttribute('aria-hidden')).toBe('true');
    expect(card.className).toContain('lo-hovercard');
    expect(card.querySelector('.lo-hovercard__term')?.textContent).toBe('bucket');
    expect(card.textContent).toContain('ChangedLocked');
    expect(card.querySelector('.lo-hovercard__body')?.textContent).toBe(
      'A token pool that refills at a fixed rate.',
    );
    expect(card.querySelector('[data-lo-before]')?.textContent).toBe(
      'Before A queue of waiting requests.',
    );
    const buttons = [...card.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      '',
      '2 suggestions',
      'Edit…',
      'History',
    ]);
    expect(buttons[0]?.getAttribute('aria-label')).toBe('More actions for bucket');
    for (const button of buttons) {
      expect(button.tabIndex).toBe(-1);
      expect(takesFocus(button)).toBe(false);
    }
    click(buttons[1]!);
    click(buttons[2]!);
    expect(ran).toEqual([
      ['terms.history', BUCKET],
      ['terms.edit', BUCKET],
    ]);
  });

  it('shows its hints’ keys only while the term has keyboard focus', () => {
    held();
    const hints = [{ command: 'terms.edit', target: BUCKET, label: 'Edit…' }];
    const host = render(<TermCard term="bucket" definition="A pool." hints={hints} />);
    expect(host.querySelector('.lo-hovercard__foot kbd')).toBeNull();
    const keyed = render(<TermCard term="bucket" definition="A pool." hints={hints} keys />);
    expect(keyed.querySelector('.lo-hovercard__foot kbd')?.textContent).toBe('i');
  });

  it('leaves out a hint whose command can’t run, and its foot with the last', () => {
    held();
    const host = render(
      <TermCard
        term="bucket"
        definition="A pool."
        hints={[{ command: 'terms.edit', label: 'Edit…' }, { command: 'terms.nothing' }]}
      />,
    );
    const foot = host.querySelector('.lo-hovercard__foot')!;
    expect(foot.querySelector('button')).toBeNull();
  });

  it('with only a definition, has no byline, link or foot', () => {
    const host = render(<TermCard term="bucket" definition="A token pool." />);
    const card = host.firstElementChild!;
    expect(card.textContent).toBe('bucketA token pool.');
    expect(card.querySelector('button')).toBeNull();
    expect(card.querySelector('.lo-hovercard__foot')).toBeNull();
  });

  it('points to the glossary for what it doesn’t show', () => {
    const none = render(<TermCard term="bucket" />);
    expect(none.querySelector('.lo-hovercard__body')?.textContent).toBe('In the glossary.');
    const more = render(<TermCard term="bucket" definition="A token pool." more />);
    expect(more.querySelector('.lo-hovercard__body')?.textContent).toBe(
      'A token pool. More in the glossary.',
    );
  });

  it('only uses utilities that Lo’s stylesheet has, so nothing is silently dropped', async () => {
    held();
    const host = render(
      <TermCard
        term="bucket"
        marks={{ mark: 'new', locked: true }}
        definition="A pool."
        before="A queue."
        byline={
          <TermByline by={{ name: 'Ravi K' }} written="agent" pull={{ number: 2 }} when="now" />
        }
        suggestions={{ count: 1, command: 'terms.history', target: BUCKET }}
        hints={[{ command: 'terms.edit', target: BUCKET }]}
        menu
      />,
    );
    const waiting = render(<TermByline reading />);
    expect(await missingRules(host)).toEqual([]);
    expect(await missingRules(waiting)).toEqual([]);
  });
});
