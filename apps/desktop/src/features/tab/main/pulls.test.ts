import { parsePullLink as link } from '@lo/review';
import { describe, expect, it } from 'vitest';

import {
  findTab,
  hasLayer,
  isSamePullRequest,
  merge,
  otherNames,
  shows,
  tabKey,
  type TabKey,
} from './pulls.ts';

/** A tab opened from `address`, once GitHub named its repository `owner/repo`. */
function named(address: string, owner: string, repo: string): TabKey {
  return { ...tabKey(link(address)), canonical: { owner, repo } };
}

describe('which tab a link points at', () => {
  it('a link to an open pull request finds its tab', () => {
    const tabs = [
      tabKey(link('github.com/sharkdp/fd/pull/2212')),
      tabKey(link('github.com/rozed-dev/playground/pull/2')),
    ];
    expect(findTab(tabs, link('https://github.com/rozed-dev/playground/pull/2'))).toBe(1);
    expect(findTab(tabs, link('https://github.com/sharkdp/fd/pull/2212/files'))).toBe(0);
  });

  it('owner and repository ignore case', () => {
    const tabs = [tabKey(link('github.com/sharkdp/fd/pull/2212'))];
    expect(findTab(tabs, link('github.com/SharkDP/FD/pull/2212'))).toBe(0);
  });

  it('another number or repository is another pull request', () => {
    const tabs = [tabKey(link('github.com/sharkdp/fd/pull/2212'))];
    const others = [
      'github.com/sharkdp/fd/pull/2213',
      'github.com/sharkdp/bat/pull/2212',
      'github.com/other/fd/pull/2212',
    ];
    expect(others.filter((other) => findTab(tabs, link(other)) !== undefined)).toEqual([]);
    expect(findTab([], link('github.com/sharkdp/fd/pull/1'))).toBeUndefined();
  });

  it('a tab opened by a new name matches the old names merged into it', () => {
    let tab: TabKey = {
      ...tabKey(link('github.com/new-owner/new-name/pull/7')),
      canonical: { owner: 'new-owner', repo: 'new-name' },
    };
    expect(shows(tab, link('github.com/old-owner/old-name/pull/7'))).toBe(false);
    const duplicate: TabKey = {
      ...tabKey(link('github.com/Old-Owner/old-name/pull/7')),
      canonical: { owner: 'new-owner', repo: 'New-Name' },
    };
    expect(isSamePullRequest(tab, duplicate)).toBe(true);
    tab = merge(tab, duplicate);
    expect(shows(tab, link('github.com/old-owner/old-name/pull/7'))).toBe(true);
    expect(shows(tab, link('github.com/old-owner/old-name/pull/8'))).toBe(false);
  });

  it('tabs are the same pull request only once github named both', () => {
    const a = named('github.com/a/b/pull/1', 'a', 'b');
    expect(isSamePullRequest(a, named('github.com/x/y/pull/1', 'A', 'B'))).toBe(true);
    expect(isSamePullRequest(a, named('github.com/a/b/pull/2', 'a', 'b'))).toBe(false);
    expect(isSamePullRequest(a, named('github.com/a/c/pull/1', 'a', 'c'))).toBe(false);
    expect(isSamePullRequest(a, tabKey(link('github.com/a/b/pull/1')))).toBe(false);
  });

  it('a renamed repository matches by its old and new name', () => {
    const tab: TabKey = {
      ...tabKey(link('github.com/old-owner/old-name/pull/7')),
      canonical: { owner: 'new-owner', repo: 'new-name' },
    };
    expect(shows(tab, link('github.com/old-owner/old-name/pull/7'))).toBe(true);
    expect(shows(tab, link('github.com/New-Owner/new-name/pull/7'))).toBe(true);
    expect(shows(tab, link('github.com/new-owner/new-name/pull/8'))).toBe(false);
  });

  it('a stacks layers are found by any of the repositorys names', () => {
    const key: TabKey = {
      ...tabKey(link('github.com/old-owner/e2e/pull/3')),
      canonical: { owner: 'rozed-dev', repo: 'e2e' },
      layers: [2, 3, 4, 6, 5],
    };
    const layers = ['github.com/rozed-dev/e2e/pull/6', 'github.com/Old-Owner/E2E/pull/2'];
    expect(layers.filter((layer) => !hasLayer(key, link(layer)))).toEqual([]);
    const others = ['github.com/rozed-dev/e2e/pull/7', 'github.com/rozed-dev/playground/pull/4'];
    expect(others.filter((other) => hasLayer(key, link(other)))).toEqual([]);
    // Only its own number is the pull request the tab shows.
    expect(shows(key, link('github.com/rozed-dev/e2e/pull/4'))).toBe(false);
  });

  it('the names besides the repositorys name now', () => {
    let key = tabKey(link('github.com/rozed-dev/playground/pull/2'));
    expect(otherNames(key)).toEqual([]);
    key = { ...key, canonical: { owner: 'rozed-dev', repo: 'renamed' } };
    key = merge(key, tabKey(link('github.com/Rozed-Dev/Renamed/pull/2')));
    key = merge(key, tabKey(link('github.com/old-owner/playground/pull/2')));
    expect(otherNames(key)).toEqual([
      { owner: 'rozed-dev', repo: 'playground' },
      { owner: 'old-owner', repo: 'playground' },
    ]);
  });
});
