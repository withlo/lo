import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { BUNDLE_ID, DOCS, routers } from './routers.ts';

/** The rule for the router called `name`. */
function ruleOf(name: string): string {
  const found = routers.find((router) => router.name === name);
  if (!found) throw new Error(`No rules for ${name}.`);
  return found.rule;
}

/** Pull request pages, as a link to one is written. */
const pulls = [
  'https://github.com/rozed-dev/e2e/pull/78',
  'https://github.com/rozed-dev/e2e/pull/78/files',
  'https://github.com/rozed-dev/e2e/pull/78/files#diff-1b2c3dR10',
  'https://github.com/rozed-dev/e2e/pull/78/commits/abc123',
  'https://github.com/rozed-dev/e2e/pull/78/checks',
  'https://github.com/rozed-dev/e2e/pull/78#discussion_r123',
  'https://github.com/rozed-dev/e2e/pull/78?notification_referrer_id=1',
  'https://github.com/a-b/c.d_e/pull/1',
];

/** Links a rule must leave to the browser, among them two that merely contain a pull request's. */
const others = [
  'https://github.com/o/r/blob/main/pull/1/x',
  'https://github.com/login?return_to=https://github.com/o/r/pull/1',
  'https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F1',
  'https://github.com/rozed-dev/e2e/issues/78',
  'https://github.com/rozed-dev/e2e',
  'https://github.com/rozed-dev/e2e/pulls',
  'https://github.com/rozed-dev/e2e/pull/new/branch',
  'https://github.com/rozed-dev/e2e/pull/78x',
  'https://github.com/rozed-dev',
  'https://github.com/',
  'https://example.com/rozed-dev/e2e/pull/78',
  'https://gist.github.com/rozed-dev/e2e/pull/78',
  'https://evil.example/?next=https://github.com/o/r/pull/1',
];

/** What Finicky says of the app that opened a link, or nothing when it can't name one. */
const from = (bundleId: string | null) => ({ opener: bundleId === null ? null : { bundleId } });

/** A link as a router may match it, without its scheme. */
const bare = (link: string) => link.replace(/^https:\/\//, '');

describe('the routers', () => {
  it('are Finicky, Velja and Choosy, each with steps and a rule', () => {
    expect(routers.map((router) => router.name)).toEqual(['Finicky', 'Velja', 'Choosy']);
    for (const router of routers) {
      expect(router.steps).not.toBe('');
      expect(router.rule).not.toBe('');
    }
  });

  it('point to the docs on GitHub, and name Lo by the bundle ID the build gives it', () => {
    expect(DOCS).toMatch(/^https:\/\/github\.com\//);
    const build = readFileSync(
      new URL('../../../../build/electron-builder.yml', import.meta.url),
      'utf8',
    );
    expect(/^appId: (\S+)$/m.exec(build)?.[1]).toBe(BUNDLE_ID);
  });

  it('say how each skips the links Lo opened', () => {
    expect(ruleOf('Finicky')).toContain(`opener?.bundleId !== "${BUNDLE_ID}"`);
    const [, velja, choosy] = routers;
    expect(velja?.steps).toMatch(/Source Apps matcher set to Lo that opens in your browser/);
    expect(velja?.steps).toMatch(/hasn’t been tried in Velja/);
    expect(velja?.steps).toMatch(/must sit above the Lo rule/);
    expect(choosy?.steps).toMatch(/the Source application is not Lo/);
    expect(choosy?.steps).toMatch(/all of these hold/);
  });
});

describe('Finicky’s rule', () => {
  interface Handler {
    match(url: URL, options: { opener: { bundleId: string } | null }): boolean;
    browser: string;
  }
  // The rule is the handler's text, which Finicky runs as JavaScript: so does this.
  const handler: Handler = runInNewContext(`(${ruleOf('Finicky').replace(/,\s*$/, '')})`);

  it('sends pull requests to Lo by its bundle ID, and nothing else', () => {
    expect(handler.browser).toBe(BUNDLE_ID);
    const opener = from('com.tinyspeck.slackmacgap');
    expect(pulls.filter((link) => !handler.match(new URL(link), opener))).toEqual([]);
    expect(others.filter((link) => handler.match(new URL(link), opener))).toEqual([]);
  });

  it('skips every link Lo opened, so "Open on GitHub" reaches the browser', () => {
    for (const link of pulls) expect(handler.match(new URL(link), from(BUNDLE_ID))).toBe(false);
    // A link from an app Finicky can't name still goes to Lo.
    expect(handler.match(new URL(pulls[0] ?? ''), from(null))).toBe(true);
  });
});

describe('Velja’s pattern', () => {
  // Matched anywhere in the link, which may or may not come with its scheme.
  const matches = new RegExp(ruleOf('Velja'));

  it('matches pull request pages, with or without the scheme, and nothing else', () => {
    expect(pulls.filter((link) => !matches.test(link) || !matches.test(bare(link)))).toEqual([]);
    expect(others.filter((link) => matches.test(link) || matches.test(bare(link)))).toEqual([]);
  });
});

describe('Choosy’s expression', () => {
  // Choosy's expression has to match the whole link, so it holds both ends itself.
  const rule = ruleOf('Choosy');
  const whole = new RegExp(rule);

  it('is anchored at both ends', () => {
    expect(rule.startsWith('^')).toBe(true);
    expect(rule.endsWith('$')).toBe(true);
  });

  it('matches pull request pages, and nothing else', () => {
    expect(pulls.filter((link) => !whole.test(link))).toEqual([]);
    expect(others.filter((link) => whole.test(link))).toEqual([]);
  });
});
