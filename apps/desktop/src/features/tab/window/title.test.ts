import { describe, expect, it } from 'vitest';

import type { Tab } from '../contract.ts';
import { forPullRequest, inStack, windowTitle, withoutBidi } from './title.ts';

describe("the window's title", () => {
  it('a pull request is named by its repository number and title', () => {
    expect(forPullRequest('sharkdp/fd', 2212, 'Honor explicit use-jemalloc requests')).toBe(
      'sharkdp/fd#2212 — Honor explicit use-jemalloc requests',
    );
    expect(forPullRequest('rozed-dev/playground', 2)).toBe('rozed-dev/playground#2');
  });

  it('a stacks layer says where it is and what the stack sits on', () => {
    const title = forPullRequest('rozed-dev/e2e', 3, 'feat: b');
    expect(inStack(title, { root: 'main', layer: 2, layers: 5 })).toBe(
      'rozed-dev/e2e#3 — feat: b · layer 2 of 5, stack on main',
    );
    // Once it merged, it's no layer of the stack.
    expect(inStack(title, { root: 'main', layers: 4 })).toBe(
      'rozed-dev/e2e#3 — feat: b · 4 layers, stack on main',
    );
  });

  it('a stack’s tab is titled by its layer on screen, and where that is once the stack is known', () => {
    const stack: Tab = {
      id: 'a',
      kind: 'pull',
      owner: 'rozed-dev',
      repo: 'e2e',
      number: 2,
      title: 'feat: b',
      layer: 3,
      layers: [2, 3],
    };
    expect(windowTitle(stack)).toBe('rozed-dev/e2e#3 — feat: b');
    expect(windowTitle({ ...stack, stack: { layers: [2, 3, 4, 6, 5], root: 'main' } })).toBe(
      'rozed-dev/e2e#3 — feat: b · layer 2 of 5, stack on main',
    );
    // A layer that left the stack, as one that merged does.
    expect(windowTitle({ ...stack, stack: { layers: [2, 4], root: 'main\u202E' } })).toBe(
      'rozed-dev/e2e#3 — feat: b · 2 layers, stack on main',
    );
  });

  it('titles lose the characters that turn text around', () => {
    // U+202E turns what follows right to left, so "Fix gpj.exe" would read "Fix exe.jpg".
    expect(forPullRequest('a/b', 1, 'Fix \u202Egpj.exe\u202C \u2067x\u2069')).toBe(
      'a/b#1 — Fix gpj.exe x',
    );
    // The marks that place numbers in right-to-left text stay.
    expect(withoutBidi('שלום \u200F1\u061C')).toBe('שלום \u200F1\u061C');
  });

  it('is the pull request on screen’s, and Lo’s name while another kind of tab is', () => {
    expect(windowTitle({ id: 'a', kind: 'pull', owner: 'sharkdp', repo: 'fd', number: 2212 })).toBe(
      'sharkdp/fd#2212',
    );
    expect(
      windowTitle({
        id: 'a',
        kind: 'pull',
        owner: 'sharkdp',
        repo: 'fd',
        number: 2212,
        title: 'Honor explicit use-jemalloc requests',
        state: 'open',
      }),
    ).toBe('sharkdp/fd#2212 — Honor explicit use-jemalloc requests');
    expect(windowTitle({ id: 'recent', kind: 'recent' })).toBe('Lo');
    expect(windowTitle({ id: 's', kind: 'settings' })).toBe('Lo');
    expect(windowTitle(undefined)).toBe('Lo');
  });
});
