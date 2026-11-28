// @vitest-environment jsdom
// A list Settings keeps per repo: every repo's, then each repo's own, which replaces it there.

import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, render } from '../test/dom.ts';
import { ScopedList, type ScopedEntry, type ScopedRepo } from './ScopedList.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const EVERY: ScopedEntry[] = [
  { key: 'Why', label: 'Why' },
  { key: 'Testing', label: 'Testing' },
];

const REPOS: ScopedRepo[] = [
  {
    repo: 'rozed-dev/e2e',
    entries: [
      { key: 'Why', label: 'Why', everywhere: true },
      { key: 'Risks', label: 'Risks' },
    ],
  },
  { repo: 'rozed-dev/api', entries: [] },
];

/** The list as Settings holds it: what's removed or reset goes, and the rest stays. */
function Held({ every = EVERY, repos = REPOS }: { every?: ScopedEntry[]; repos?: ScopedRepo[] }) {
  const [all, setAll] = useState(every);
  const [own, setOwn] = useState(repos);
  return (
    <ScopedList
      kind="heading"
      every={all}
      repos={own}
      onRemove={(key, repo) => {
        if (repo === undefined) setAll((held) => held.filter((entry) => entry.key !== key));
        else {
          setOwn((held) =>
            held.map((scope) =>
              scope.repo === repo
                ? { ...scope, entries: scope.entries.filter((entry) => entry.key !== key) }
                : scope,
            ),
          );
        }
      }}
      onEverywhere={(key, repo) =>
        setOwn((held) =>
          held.map((scope) =>
            scope.repo === repo
              ? {
                  ...scope,
                  entries: scope.entries.map((entry) =>
                    entry.key === key ? { ...entry, everywhere: true } : entry,
                  ),
                }
              : scope,
          ),
        )
      }
      onReset={(repo) => setOwn((held) => held.filter((scope) => scope.repo !== repo))}
    />
  );
}

/** The scope `scope` of the list, `*` for every repo's. */
function scopeOf(host: HTMLElement, scope: string): HTMLElement | undefined {
  return [...host.querySelectorAll<HTMLElement>('[data-scope]')].find(
    (each) => each.dataset['scope'] === scope,
  );
}

/** What each entry of `scope` says, its buttons' words and all. */
function words(scope: HTMLElement): string[] {
  return [...scope.querySelectorAll('[role="listitem"]')].map((item) => item.textContent);
}

/** The button named `label` in `host`. */
function button(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (each) => each.getAttribute('aria-label') === label,
  );
}

describe('ScopedList', () => {
  it('lists every repo’s entries, then each repo’s, which replace them there', () => {
    const host = render(<Held />);
    const scopes = [...host.querySelectorAll<HTMLElement>('[data-scope]')];
    expect(scopes.map((scope) => scope.dataset['scope'])).toEqual([
      '*',
      'rozed-dev/e2e',
      'rozed-dev/api',
    ]);
    expect(scopes.map((scope) => scope.firstElementChild?.textContent)).toEqual([
      'Every repo',
      'rozed-dev/e2e · replaces every repo’s listReset',
      'rozed-dev/api · replaces every repo’s listReset',
    ]);
    expect(words(scopes[0]!)).toEqual(['WhyRemove', 'TestingRemove']);
    // An entry that's in every repo's list too has no "Collapse in every repo".
    expect(words(scopes[1]!)).toEqual(['WhyRemove', 'RisksCollapse in every repoRemove']);
    expect(scopes[2]?.textContent).toContain('None in this repo');
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Collapsed sections',
    );
  });

  it('names its buttons for what they act on', () => {
    const host = render(<Held />);
    expect(button(host, 'Remove Testing')).toBeDefined();
    expect(button(host, 'Collapse Risks in every repo')).toBeDefined();
    expect(button(host, 'Reset rozed-dev/e2e')).toBeDefined();
  });

  it('says what an ignored terms list says, with its own words', () => {
    const removed = vi.fn<(key: string, repo: string | undefined) => void>();
    const everywhere = vi.fn<(key: string, repo: string) => void>();
    const host = render(
      <ScopedList
        kind="term"
        every={[{ key: 'bucket', label: 'bucket' }]}
        repos={[{ repo: 'rozed-dev/e2e', entries: [{ key: 'refill', label: 'refill' }] }]}
        onRemove={removed}
        onEverywhere={everywhere}
      />,
    );
    click(button(host, 'Stop ignoring bucket')!);
    expect(removed).toHaveBeenCalledWith('bucket', undefined);
    click(button(host, 'Ignore refill in every repo')!);
    expect(everywhere).toHaveBeenCalledWith('refill', 'rozed-dev/e2e');
    click(button(host, 'Stop ignoring refill')!);
    expect(removed).toHaveBeenLastCalledWith('refill', 'rozed-dev/e2e');
  });

  it('says when there’s nothing in it, or nothing in every repo’s', () => {
    const none = render(<ScopedList kind="term" every={[]} />);
    expect(none.textContent).toBe('No ignored terms');
    const own = render(<Held every={[]} />);
    expect(scopeOf(own, '*')?.textContent).toBe('Every repoNone in every repo');
  });

  it('hands focus to the next entry, else the one before, else its scope, as entries go', () => {
    const host = render(<Held />);
    focus(button(host, 'Remove Why')!);
    click(button(host, 'Remove Why')!);
    expect(document.activeElement).toBe(button(host, 'Remove Testing'));
    click(button(host, 'Remove Testing')!);
    // Every repo's list is empty now, and its scope has no button: focus goes to the list.
    expect(document.activeElement).toBe(host.querySelector('[role="group"]'));
    focus(button(host, 'Remove Risks')!);
    click(button(host, 'Remove Risks')!);
    expect(document.activeElement).toBe(button(host, 'Remove Why'));
  });

  it('hands focus to the next entry’s own Remove, never its “Collapse in every repo”', () => {
    const host = render(<Held />);
    // Risks, after Why in the repo's list, isn't in every repo's: its first button widens it.
    const why = button(scopeOf(host, 'rozed-dev/e2e')!, 'Remove Why')!;
    focus(why);
    click(why);
    const risks = scopeOf(host, 'rozed-dev/e2e')!;
    expect(document.activeElement).toBe(button(risks, 'Remove Risks'));
    expect(button(risks, 'Collapse Risks in every repo')).toBeDefined();
  });

  it('keeps focus on the entry made every repo’s, and hands it on as a repo is reset', () => {
    const host = render(<Held />);
    focus(button(host, 'Collapse Risks in every repo')!);
    click(button(host, 'Collapse Risks in every repo')!);
    expect(button(host, 'Collapse Risks in every repo')).toBeUndefined();
    expect(document.activeElement).toBe(button(host, 'Remove Risks'));
    focus(button(host, 'Reset rozed-dev/e2e')!);
    click(button(host, 'Reset rozed-dev/e2e')!);
    expect(scopeOf(host, 'rozed-dev/e2e')).toBeUndefined();
    expect(document.activeElement).toBe(button(host, 'Reset rozed-dev/api'));
    click(button(host, 'Reset rozed-dev/api')!);
    expect(document.activeElement).toBe(button(host, 'Remove Why'));
  });

  it('only uses utilities that Lo’s stylesheet has, so nothing is silently dropped', async () => {
    const host = render(<Held />);
    const none = render(<ScopedList kind="heading" every={[]} />);
    expect(await missingRules(host)).toEqual([]);
    expect(await missingRules(none)).toEqual([]);
  });
});
