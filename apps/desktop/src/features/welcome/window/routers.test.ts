import { describe, expect, it } from 'vitest';

import { DOCS, routers } from './routers.ts';

/** The rule for the router called `name`. */
function ruleOf(name: string): string {
  const found = routers.find((router) => router.name === name);
  if (!found) throw new Error(`No rules for ${name}.`);
  return found.rule;
}

const pulls = [
  'https://github.com/rozed-dev/e2e/pull/78',
  'https://github.com/rozed-dev/e2e/pull/78/files',
  'https://github.com/rozed-dev/e2e/pull/78/commits/abc123',
  'https://github.com/rozed-dev/e2e/pull/78/checks',
  'https://github.com/a-b/c.d_e/pull/1',
];
const others = [
  'https://github.com/rozed-dev/e2e/issues/78',
  'https://github.com/rozed-dev/e2e',
  'https://github.com/rozed-dev/e2e/pulls',
  'https://github.com/rozed-dev/e2e/pull/new',
  'https://github.com/rozed-dev',
  'https://github.com/',
  'https://example.com/rozed-dev/e2e/pull/78',
  'https://gist.github.com/rozed-dev/e2e/pull/78',
];

describe('the routers', () => {
  it('are Finicky, Velja and Choosy, each with steps and a rule', () => {
    expect(routers.map((router) => router.name)).toEqual(['Finicky', 'Velja', 'Choosy']);
    for (const router of routers) {
      expect(router.steps).not.toBe('');
      expect(router.rule).not.toBe('');
    }
  });

  it('write the name Lo as the app is, and point to the docs on GitHub', () => {
    expect(ruleOf('Finicky')).toContain('browser: "Lo"');
    expect(DOCS).toMatch(/^https:\/\/github\.com\//);
  });
});

describe('Finicky’s rule', () => {
  // The rule is a handler's text. It matches the host, then a regular expression on the path.
  const rule = ruleOf('Finicky');
  const path = /\.test\(url\.pathname\)/.test(rule)
    ? /(\/\^.+\/)\.test/.exec(rule)?.[1]
    : undefined;
  const onPath = new RegExp((path ?? '').slice(1, -1));

  const matches = (link: string) => {
    const url = new URL(link);
    return url.host === 'github.com' && onPath.test(url.pathname);
  };

  it('matches github.com’s pull request pages, and nothing else', () => {
    expect(rule).toContain('url.host === "github.com"');
    expect(rule).toContain('browser: "Lo"');
    expect(pulls.filter((link) => !matches(link))).toEqual([]);
    expect(others.filter(matches)).toEqual([]);
  });
});

describe('Choosy’s rule', () => {
  // Choosy's expression has to match the whole link.
  const whole = new RegExp(`^(?:${ruleOf('Choosy')})$`);

  it('matches a pull request and its pages, and nothing else', () => {
    expect(pulls.filter((link) => !whole.test(link))).toEqual([]);
    expect(others.filter((link) => whole.test(link))).toEqual([]);
  });
});

const bare = (link: string) => link.replace(/^https:\/\//, '');

describe('Velja’s pattern', () => {
  // A wildcard pattern, `*` for any run of characters, on the link without its scheme.
  const pattern = ruleOf('Velja');
  const matches = new RegExp(`^${pattern.replaceAll('.', '\\.').replaceAll('*', '.*')}$`);

  it('matches a pull request and its pages, and nothing else', () => {
    expect(pulls.filter((link) => !matches.test(bare(link)))).toEqual([]);
    expect(others.filter((link) => matches.test(bare(link)) && !link.includes('gist.'))).toEqual([
      'https://github.com/rozed-dev/e2e/pull/new',
    ]);
  });
});
