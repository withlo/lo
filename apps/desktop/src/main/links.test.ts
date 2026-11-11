import { describe, expect, it } from 'vitest';

import { LINK_LIMIT, LinkInbox, linksIn, MOST_LINKS } from './links.ts';

const PULL = 'https://github.com/withlo/lo/pull/1';

describe('linksIn', () => {
  it('takes the lo:// and web links from a command line, and nothing else', () => {
    expect(
      linksIn([
        '/Applications/Lo.app/Contents/MacOS/Lo',
        '.',
        '--use-mock-keychain',
        'LO://github.com/withlo/lo/pull/1',
        PULL,
        'http://github.com/withlo/lo/pull/2',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'github.com/withlo/lo/pull/3',
        ' https://github.com/withlo/lo/pull/4',
      ]),
    ).toEqual(['LO://github.com/withlo/lo/pull/1', PULL, 'http://github.com/withlo/lo/pull/2']);
  });

  it('takes no link longer than the limit, and no more links than the most', () => {
    expect(linksIn([`${PULL}?${'x'.repeat(LINK_LIMIT)}`])).toEqual([]);
    expect(linksIn(Array.from({ length: MOST_LINKS + 5 }, () => PULL))).toHaveLength(MOST_LINKS);
  });
});

describe('LinkInbox', () => {
  it('keeps links until something takes them, then hands each over as it comes', () => {
    const inbox = new LinkInbox();
    const taken: string[] = [];
    inbox.receive(PULL);
    inbox.receive('not a link');
    inbox.receive('lo://github.com/withlo/lo/pull/2');
    const stop = inbox.take((link) => taken.push(link));
    expect(taken).toEqual([PULL, 'lo://github.com/withlo/lo/pull/2']);
    inbox.receive('https://github.com/withlo/lo/pull/3');
    expect(taken).toHaveLength(3);
    stop();
    inbox.receive('https://github.com/withlo/lo/pull/4');
    expect(taken).toHaveLength(3);
  });

  it('keeps no more than the most links waiting', () => {
    const inbox = new LinkInbox();
    for (let index = 0; index < MOST_LINKS * 2; index++) inbox.receive(PULL);
    const taken: string[] = [];
    inbox.take((link) => taken.push(link));
    expect(taken).toHaveLength(MOST_LINKS);
  });
});
