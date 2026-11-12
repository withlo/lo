// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';

import { act, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  parseArtifact,
  type Definition,
  type Excerpt,
  type Glossary as GlossaryBlock,
  type OverviewBlock,
  type OverviewTree,
} from '@lo/artifact';

import { buildCss, hasRule } from '../../scripts/stylesheet.ts';
import { cleanUp, click, disallowed, focus, ids, press, render, rerender } from '../../test/dom.ts';
import { isMarkdownAttribute, MARKDOWN_ELEMENTS } from '../markdown/index.ts';
import {
  alphabetical,
  closeCards,
  HOVER_CLOSE_MS,
  HOVER_OPEN_MS,
  isStop,
  OverviewDocument,
  type OverviewTarget,
} from './index.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
  vi.useRealTimers();
});

// The base is named first: under jsdom, Vite rewrites `new URL('…', import.meta.url)` into an
// address on its dev server.
const here = import.meta.url;
const ARTIFACTS = new URL('../../../../../testing/fixtures/artifacts/', here);
const HOSTILE_MARKDOWN = new URL('../../../../../testing/fixtures/markdown/hostile/', here);

/** The tree of a fixture's `artifact.md`, as the parse makes it. */
function fixture(path: string): OverviewTree {
  return parseArtifact(readFileSync(new URL(`${path}/artifact.md`, ARTIFACTS))).tree;
}

const HEADER = '---\nformat: 1\npr: 1\ncommit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87\n---\n\n';

function overview(markdown: string): OverviewTree {
  const parsed = parseArtifact(`${HEADER}## tl;dr\n\nWhat it does.\n\n${markdown}`);
  expect(parsed.findings.filter((finding) => finding.code !== 'term-unused')).toEqual([]);
  return parsed.tree;
}

describe('OverviewDocument', () => {
  it('draws every kind of block an overview holds', () => {
    const page = render(<OverviewDocument tree={fixture('valid/example')} />);
    // The plain kinds draw as `@lo/markdown`'s do, each in the renderer's own tests.
    const kinds: Record<string, string> = {
      heading: 'h2',
      paragraph: 'p',
      details: 'details.lo-fold',
      excerpt: '.lo-block .lo-codeblock__head',
      figure: '.lo-block figure.lo-figure figcaption',
      walkthrough: '.lo-block .lo-walk .lo-walk__step',
      tabs: '.lo-block .lo-tabs [role="tablist"]',
      glossary: 'dl.lo-glossary dt',
    };
    expect(
      Object.entries(kinds).flatMap(([kind, selector]) =>
        page.querySelector(selector) ? [] : [kind],
      ),
    ).toEqual([]);
    expect(page.querySelector('.lo-codeblock__path')?.textContent).toBe('src/limiter.ts');
    expect(page.querySelector('.lo-codeblock__path b')?.textContent).toBe('limiter.ts');
    expect(page.querySelector('.lo-codeblock__lines')?.textContent).toBe('L46–61');
    expect(page.querySelector('.lo-walk__title')?.textContent).toBe('One request, start to finish');
    expect(page.querySelectorAll('.lo-walk__step')).toHaveLength(3);
    expect(page.querySelector('.lo-fold__kind')?.textContent).toBe('More detail');
  });

  it('lists the sections in the writer’s order, the first current, and moves to one chosen', () => {
    const page = render(<OverviewDocument tree={fixture('valid/example')} />);
    const items = [...page.querySelectorAll<HTMLButtonElement>('.lo-ov__toc .lo-toc__item')];
    expect(items.map((item) => item.textContent)).toEqual([
      'tl;dr',
      'How it works',
      'Where to look',
      'How it was checked',
      'Glossary',
    ]);
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    click(items[2]!);
    expect(document.activeElement?.textContent).toBe('Where to look');
    expect(items[2]?.getAttribute('aria-current')).toBe('true');
  });

  it('leaves the outline out when asked, and sets the tl;dr as the lead', () => {
    const page = render(<OverviewDocument tree={fixture('valid/example')} outline={false} />);
    expect(page.querySelector('.lo-ov__toc')).toBeNull();
    expect(page.querySelector('.lo-ov')?.classList.contains('grid-cols-1')).toBe(true);
    expect(page.querySelector('.lo-lead')?.textContent).toBe(
      'Requests over a quota now wait for a token instead of failing.',
    );
    expect(page.querySelectorAll('.lo-lead')).toHaveLength(1);
  });

  it('puts the byline and a banner at the top of the article, before the sections', () => {
    const page = render(
      <OverviewDocument
        tree={fixture('valid/smallest')}
        byline={<div className="lo-ov-byline">byline</div>}
        banner={<div className="lo-ov-stale">banner</div>}
      />,
    );
    const article = page.querySelector('article.lo-ov__article.lo-prose')!;
    expect([...article.children].slice(0, 3).map((child) => child.textContent)).toEqual([
      'byline',
      'banner',
      'tl;dr',
    ]);
  });

  it('lays out the outline and the article unseen while its blocks draw, in a box that takes focus', () => {
    const tree = fixture('valid/example');
    const page = render(<OverviewDocument tree={tree} drawing />);
    const box = page.querySelector('.lo-ov')!;
    expect(box.classList.contains('is-drawing')).toBe(true);
    expect(box.querySelector('article.lo-ov__article')).not.toBeNull();
    rerender(page, <OverviewDocument tree={tree} />);
    expect(box.classList.contains('is-drawing')).toBe(false);
  });

  it('draws the blocks given views for, in place of what they point at', () => {
    const page = render(
      <OverviewDocument
        tree={fixture('valid/example')}
        views={{
          excerpt: (node) => <div className="excerpt">{node.target.path}</div>,
          figure: (node) => <div className="figure">{node.path}</div>,
          walkthrough: (node) => <div className="walkthrough">{node.steps.length}</div>,
        }}
      />,
    );
    expect(page.querySelector('.excerpt')?.textContent).toBe('src/limiter.ts');
    expect(page.querySelector('.figure')?.textContent).toBe('figures/flow.svg');
    expect(page.querySelector('.walkthrough')?.textContent).toBe('3');
    expect(page.querySelector('.lo-codeblock, .lo-figure, .lo-walk')).toBeNull();
  });

  it('hands code links, and pages, to whoever shows it', () => {
    const onFollow = vi.fn<(target: OverviewTarget, from: Element) => void>();
    const page = render(
      <OverviewDocument
        tree={overview(
          'See [the store](code:src/store.ts#L4-L9), [the docs](https://example.com/docs) and [plain](http://example.com/).\n',
        )}
        onFollow={onFollow}
      />,
    );
    const links = [...page.querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual(['the store', 'the docs']);
    press(links[0]!, 'Enter');
    click(links[1]!);
    expect(onFollow.mock.calls).toEqual([
      [{ kind: 'code', path: 'src/store.ts', lines: { start: 4, end: 9 } }, links[0]],
      [{ kind: 'web', url: 'https://example.com/docs' }, links[1]],
    ]);
  });

  it('moves to a section a link names, in its own document only', () => {
    const first = render(<OverviewDocument tree={fixture('valid/example')} />);
    const onFollow = vi.fn<(target: OverviewTarget, from: Element) => void>();
    const second = render(<OverviewDocument tree={fixture('valid/example')} onFollow={onFollow} />);
    const all = [...ids(first), ...ids(second)];
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(id).toMatch(/^lo-md\w+-/);

    const link = [...second.querySelectorAll('a')].find((each) => each.textContent === 'the rest')!;
    click(link);
    const heading = [...second.querySelectorAll('h2')].find(
      (each) => each.textContent === 'How it works',
    );
    expect(document.activeElement).toBe(heading);
    expect(onFollow).toHaveBeenCalledWith({ kind: 'anchor', name: 'how-it-works' }, link);
    const current = second.querySelector('.lo-toc__item[aria-current="true"]');
    expect(current?.textContent).toBe('How it works');
  });
});

/** An overview with headings in a closed fold and a tab not shown, and links to them. */
const hidden = () =>
  overview(
    [
      ':::fold Why',
      '### Deep down',
      '',
      'Inside the fold.',
      ':::',
      '',
      ':::tabs',
      ':::tab One',
      'First.',
      ':::',
      ':::tab Two',
      '### Second tab',
      '',
      'In the second tab.',
      ':::',
      ':::',
      '',
      'See [deep](#deep-down) and [second](#second-tab).',
      '',
    ].join('\n'),
  );

describe('moving to what a link names', () => {
  it('opens a closed fold to reach a heading in it', () => {
    const page = render(<OverviewDocument tree={hidden()} />);
    const fold = page.querySelector('details')!;
    expect(fold.open).toBe(false);
    click(linkSaying(page, 'deep'));
    expect(fold.open).toBe(true);
    expect(document.activeElement?.textContent).toBe('Deep down');
    // The fold knows it's open: its title closes it again.
    click(fold.querySelector('summary')!);
    expect(fold.open).toBe(false);
  });

  it('shows the tab a heading is in to reach it', () => {
    const page = render(<OverviewDocument tree={hidden()} />);
    press(linkSaying(page, 'second'), 'Enter');
    const tabs = [...page.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(document.activeElement?.textContent).toBe('Second tab');
    expect(document.activeElement?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(
      false,
    );
  });
});

/** An overview with `count` tabs, then a fold. */
const withTabs = (count: number) =>
  overview(
    [
      ':::tabs',
      ...Array.from({ length: count }, (_, index) => [
        `:::tab T${index + 1}`,
        `Tab ${index + 1}.`,
        ':::',
      ]).flat(),
      ':::',
      '',
      ':::fold Why',
      'Because.',
      ':::',
      '',
    ].join('\n'),
  );
/** Each tab's `aria-selected`. */
const selected = (page: HTMLElement) =>
  [...page.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('aria-selected'));

describe('drawing again', () => {
  it('keeps what the reader opened while the tree is the same, and starts a new tree fresh', () => {
    const tree = withTabs(3);
    const page = render(<OverviewDocument tree={tree} />);
    click(page.querySelectorAll('[role="tab"]')[2]!);
    click(page.querySelector('summary')!);
    expect(selected(page)).toEqual(['false', 'false', 'true']);
    expect(page.querySelector('details')?.open).toBe(true);

    rerender(page, <OverviewDocument tree={tree} focused={0} />);
    expect(selected(page)).toEqual(['false', 'false', 'true']);
    expect(page.querySelector('details')?.open).toBe(true);

    // A new overview, with fewer tabs in the same place: its own first tab, its fold closed.
    rerender(page, <OverviewDocument tree={withTabs(2)} />);
    expect(selected(page)).toEqual(['true', 'false']);
    expect(page.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toBe('Tab 1.');
    expect(page.querySelector('details')?.open).toBe(false);
  });

  it('draws a block again only when what it shows changes, not for the outline, focus or terms', () => {
    const tree = example();
    const excerpt = vi.fn<(node: Excerpt) => ReactNode>((node: Excerpt) => (
      <div className="excerpt">{node.target.path}</div>
    ));
    const views = { excerpt };
    const page = render(<OverviewDocument tree={tree} views={views} onFollow={() => undefined} />);
    expect(excerpt).toHaveBeenCalledTimes(1);

    click(page.querySelectorAll('.lo-toc__item')[2]!);
    focus(term(page));
    press(term(page), 'Enter');
    const at = (kind: OverviewBlock['kind']) =>
      tree.blocks.findIndex((block) => block.kind === kind);
    rerender(
      page,
      <OverviewDocument
        tree={tree}
        views={views}
        focused={at('tabs')}
        onFollow={() => undefined}
      />,
    );
    expect(excerpt).toHaveBeenCalledTimes(1);

    // The block that takes focus draws again, with its ring.
    rerender(page, <OverviewDocument tree={tree} views={views} focused={at('excerpt')} />);
    expect(excerpt).toHaveBeenCalledTimes(2);
  });
});

describe('blocks', () => {
  it('numbers the blocks the block keys stop at, and leaves plain prose and headings out', () => {
    const tree = fixture('valid/example');
    const page = render(<OverviewDocument tree={tree} />);
    const stops = tree.blocks.flatMap((block, index) => (isStop(block) ? [index] : []));
    expect(
      [...page.querySelectorAll('[data-lo-block]')].map((each) =>
        Number(each.getAttribute('data-lo-block')),
      ),
    ).toEqual(stops);
    expect(stops.map((index) => tree.blocks[index]?.kind)).toEqual([
      'paragraph',
      'excerpt',
      'figure',
      'walkthrough',
      'tabs',
      'details',
      'paragraph',
    ]);
    // The tl;dr links to nothing; the paragraph that links to a term is a stop.
    expect(isStop(tree.blocks[1]!)).toBe(false);
  });

  it('stops at the glossary when a definition links to code or a term', () => {
    const plain = overview(
      'Uses [a cache](term:cache).\n\n## Glossary\n\n- **Cache**: kept in memory.\n',
    );
    expect(isStop(glossaryOf(plain))).toBe(false);
    const linked = overview(
      'Uses [a cache](term:cache).\n\n## Glossary\n\n- **Cache**: kept by [the store](code:src/store.ts).\n',
    );
    const page = render(
      <OverviewDocument tree={linked} focused={linked.blocks.indexOf(glossaryOf(linked))} />,
    );
    const block = page.querySelector('.is-focused')!;
    expect(block.className).toBe('lo-block lo-block--prose is-focused');
    expect(block.firstElementChild?.localName).toBe('dl');
  });

  it('stops at prose whose only links go to web pages, which can be followed, but not to http ones', () => {
    const [, web, plain, insecure, section] = paragraphsOf(
      [
        'The [design notes](https://example.com/design) say why.',
        'Nothing here links anywhere.',
        'The [old notes](http://example.com/old) aren’t opened.',
        'As [the tl;dr](#tldr) says.',
      ].join('\n\n'),
    );
    expect([web, plain, insecure, section].map((block) => block && isStop(block))).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  it('draws the focused block’s ring and its keys, and keeps prose’s spacing around prose', () => {
    const tree = fixture('valid/example');
    const at = (kind: OverviewBlock['kind']) =>
      tree.blocks.findIndex((block) => block.kind === kind);
    const focusedOn = (index: number) => {
      cleanUp();
      return render(<OverviewDocument tree={tree} focused={index} />);
    };

    let page = focusedOn(at('excerpt'));
    let block = page.querySelector('.is-focused')!;
    expect(block.className).toBe('lo-block is-focused');
    expect(page.querySelectorAll('.is-focused')).toHaveLength(1);
    expect(hints(block)).toEqual(['⏎ Go to code', 'o Open beside']);
    expect(block.querySelector('.lo-block__hints')?.getAttribute('aria-hidden')).toBe('true');

    page = focusedOn(at('tabs'));
    expect(hints(page.querySelector('.is-focused')!)).toEqual(['← → Switch tabs']);

    page = focusedOn(at('details'));
    block = page.querySelector('.is-focused')!;
    expect(block.localName).toBe('details');
    expect(block.className).toBe('lo-fold lo-block lo-block--fold is-focused');
    expect(block.querySelector(':scope > summary > .lo-block__hints')).not.toBeNull();
    expect(hints(block)).toEqual(['⏎ Open or close']);

    page = focusedOn(at('paragraph') + 2);
    block = page.querySelector('.is-focused')!;
    expect(block.className).toBe('lo-block lo-block--prose is-focused');
    expect(block.firstElementChild?.localName).toBe('p');
    expect(hints(block)).toEqual(['Tab Next link', '⏎ Follow']);

    // Unfocused, no chip is drawn at all.
    page = focusedOn(-1);
    expect(page.querySelector('.lo-block__hints, .is-focused')).toBeNull();
  });
});

const example = () => fixture('valid/example');
const term = (page: HTMLElement) => page.querySelector<HTMLElement>('.lo-term')!;
const card = () => document.querySelector('.lo-hovercard');

describe('terms', () => {
  it('shows the definition while the term has focus, and closes it on Esc and on blur', () => {
    const page = render(<OverviewDocument tree={example()} />);
    const use = term(page);
    expect(use.textContent).toBe('bucket');
    expect(use.getAttribute('role')).toBe('link');
    expect(use.tabIndex).toBe(0);
    expect(card()).toBeNull();

    focus(use);
    expect(use.classList.contains('is-active')).toBe(true);
    expect(card()?.textContent).toBe(
      'Bucketthe tokens a tenant has to spend. Each request takes one.Glossary⏎',
    );
    expect(card()?.className).toContain('lo-popover lo-hovercard');
    expect([...card()!.children].map((part) => part.className)).toEqual([
      'lo-hovercard__term',
      'lo-hovercard__body',
      'lo-hovercard__foot',
    ]);
    // The card is a copy: screen readers hear the glossary, which describes the term.
    expect(card()?.getAttribute('aria-hidden')).toBe('true');
    const described = document.getElementById(use.getAttribute('aria-describedby')!);
    expect(described?.localName).toBe('dd');
    expect(described?.textContent).toBe(
      'the tokens a tenant has to spend. Each request takes one.',
    );

    press(use, 'Escape');
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(use);
    act(() => use.blur());
    focus(use);
    expect(card()).not.toBeNull();
    act(() => use.blur());
    expect(card()).toBeNull();
  });

  it('keeps a card closed by Esc closed while the window is away, until focus leaves the term', () => {
    vi.useFakeTimers();
    const page = render(<OverviewDocument tree={example()} />);
    const use = term(page);
    /** The window losing focus, then getting it back: the term stays the focused element. */
    const away = () => {
      act(() => {
        use.dispatchEvent(new FocusEvent('blur'));
        use.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
      expect(document.activeElement).toBe(use);
      act(() => {
        use.dispatchEvent(new FocusEvent('focus'));
        use.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      });
    };

    focus(use);
    // Without `Esc`, the card comes back with the window, as focus does.
    away();
    expect(card()).not.toBeNull();

    press(use, 'Escape');
    away();
    expect(card()).toBeNull();
    // Focus leaving the term ends it.
    act(() => use.blur());
    focus(use);
    expect(card()).not.toBeNull();

    // So does the pointer opening the card again.
    press(use, 'Escape');
    move(document.body, use);
    act(() => {
      vi.advanceTimersByTime(HOVER_OPEN_MS);
    });
    expect(card()).not.toBeNull();
    move(use, document.body);
    away();
    expect(card()).not.toBeNull();
  });

  it('closes on the window’s own Esc as on the term’s: focus stays, and the card stays closed', () => {
    vi.useFakeTimers();
    const page = render(<OverviewDocument tree={example()} />);
    const use = term(page);
    expect(closeCards()).toBe(false);
    focus(use);
    expect(card()).not.toBeNull();
    act(() => {
      expect(closeCards()).toBe(true);
    });
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(use);
    expect(closeCards()).toBe(false);
    // The window going and coming back leaves it closed, as the term's own `Esc` does.
    act(() => {
      use.dispatchEvent(new FocusEvent('blur'));
      use.dispatchEvent(new FocusEvent('focus'));
    });
    expect(card()).toBeNull();

    // One the pointer opened closes too.
    act(() => use.blur());
    move(document.body, use);
    act(() => {
      vi.advanceTimersByTime(HOVER_OPEN_MS);
    });
    expect(card()).not.toBeNull();
    act(() => {
      expect(closeCards()).toBe(true);
    });
    expect(use.classList.contains('is-active')).toBe(false);
  });

  it('opens on a pointer that rests on the term, and stays while it’s on the card', () => {
    vi.useFakeTimers();
    const page = render(<OverviewDocument tree={example()} />);
    const use = term(page);
    const open = () => use.classList.contains('is-active');
    move(document.body, use);
    act(() => {
      vi.advanceTimersByTime(HOVER_OPEN_MS - 1);
    });
    expect(card()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(card()).not.toBeNull();

    // On to the card: it stays.
    move(use, card()!);
    act(() => {
      vi.advanceTimersByTime(HOVER_CLOSE_MS * 2);
    });
    expect(open()).toBe(true);
    // Off it: it closes, after a moment.
    move(card()!, document.body);
    act(() => {
      vi.advanceTimersByTime(HOVER_CLOSE_MS - 1);
    });
    expect(open()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(open()).toBe(false);
    // Base UI takes the card away a frame on.
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(card()).toBeNull();

    // With focus, the pointer leaving doesn't close it.
    focus(use);
    move(document.body, use);
    move(use, document.body);
    act(() => {
      vi.advanceTimersByTime(HOVER_CLOSE_MS * 2);
    });
    expect(open()).toBe(true);
    act(() => use.blur());
    expect(open()).toBe(false);

    // Passing over a term opens nothing.
    move(document.body, use);
    act(() => {
      vi.advanceTimersByTime(HOVER_OPEN_MS / 2);
    });
    move(use, document.body);
    act(() => {
      vi.advanceTimersByTime(HOVER_OPEN_MS * 2);
    });
    expect(open()).toBe(false);
  });

  it('goes to its glossary entry on ⏎, and marks it until the reader moves on', () => {
    const onFollow = vi.fn<(target: OverviewTarget, from: Element) => void>();
    const page = render(<OverviewDocument tree={example()} onFollow={onFollow} />);
    const use = term(page);
    focus(use);
    press(use, 'Enter');
    const entry = page.querySelector<HTMLElement>('dt.is-target');
    expect(entry?.textContent).toBe('Bucket');
    expect(page.querySelector('dd.is-target')?.textContent).toContain('the tokens a tenant');
    expect(document.activeElement).toBe(entry);
    expect(card()).toBeNull();
    expect(onFollow).toHaveBeenCalledWith({ kind: 'term', key: 'bucket' }, use);

    focus(use);
    expect(page.querySelector('.is-target')).toBeNull();
    click(use);
    expect(document.activeElement).toBe(page.querySelector('dt.is-target'));
  });

  it('shows the definition’s own links as their text in the card', () => {
    const page = render(
      <OverviewDocument
        tree={overview(
          'Uses [a cache](term:cache).\n\n## Glossary\n\n- **Cache**: kept in [the store](code:src/store.ts#L1), see [it](https://example.com/).\n',
        )}
      />,
    );
    focus(term(page));
    expect(card()?.textContent).toContain('kept in the store, see it.');
    expect(card()?.querySelector('a, [tabindex]')).toBeNull();
    // The glossary's copy has them as links.
    expect([...page.querySelectorAll('dd a')].map((link) => link.textContent)).toEqual([
      'the store',
      'it',
    ]);
  });

  it('copies only a definition’s opening words: no id, nothing that takes focus, no code view', () => {
    const tree = overview(
      'Uses [a cache](term:cache).\n\n## Glossary\n\n- **Cache**: kept in memory.\n',
    );
    const definition = glossaryOf(tree).terms[0]!;
    // A definition that goes on past its first paragraph.
    definition.children.push(
      {
        kind: 'heading',
        level: 3,
        anchor: 'inside',
        children: [{ kind: 'text', value: 'Inside' }],
      },
      { kind: 'excerpt', target: { kind: 'code', path: 'src/a.ts', lines: { start: 1, end: 2 } } },
      {
        kind: 'details',
        open: true,
        summary: [{ kind: 'text', value: 'Why' }],
        children: [{ kind: 'paragraph', children: [{ kind: 'text', value: 'Because.' }] }],
      },
    );
    const excerpt = vi.fn<(node: Excerpt) => ReactNode>((node: Excerpt) => (
      <div className="excerpt">{node.target.path}</div>
    ));
    const views = { excerpt };
    const page = render(<OverviewDocument tree={tree} views={views} />);
    // The glossary draws the definition whole.
    expect(excerpt).toHaveBeenCalledTimes(1);
    expect(page.querySelector('dd h3')?.textContent).toBe('Inside');

    focus(term(page));
    expect(card()?.textContent).toBe('Cachekept in memory. More in the glossary.Glossary⏎');
    expect(
      card()?.querySelector('[id], [tabindex], a, summary, details, h1, h2, h3, h4, h5, h6'),
    ).toBeNull();
    expect(excerpt).toHaveBeenCalledTimes(1);
  });

  it('points to the glossary when a definition doesn’t open with a paragraph', () => {
    const tree = overview(
      'Uses [a cache](term:cache).\n\n## Glossary\n\n- **Cache**: kept in memory.\n',
    );
    const definition = glossaryOf(tree).terms[0]!;
    definition.children = [{ kind: 'rule' }];
    const page = render(<OverviewDocument tree={tree} />);
    focus(term(page));
    expect(card()?.querySelector('.lo-hovercard__body')?.textContent).toBe('In the glossary.');
  });

  it('adds nothing that takes focus, so Tab goes from a term to what follows it', () => {
    const page = render(<OverviewDocument tree={example()} />);
    const before = tabbable();
    const use = term(page);
    focus(use);
    expect(card()).not.toBeNull();
    expect(tabbable()).toEqual(before);
    // What follows the term on the page is still its text, not a stop of the card's.
    expect(use.nextElementSibling).toBeNull();
  });
});

describe('glossary', () => {
  it('lists the terms in alphabetical order, whatever order they were written in', () => {
    const page = render(
      <OverviewDocument
        tree={overview(
          [
            'Uses [w](term:weight), [c](term:Cost), [b](term:bucket), [p](<term:page size>), [10](<term:item 10>), [2](<term:item 2>).',
            '',
            '## Glossary',
            '',
            '- **weight**: what a field adds.',
            '- **Cost**: what a query is charged.',
            '- **page size**: a list field’s first.',
            '- **item 10**: the tenth.',
            '- **bucket**: what a caller holds.',
            '- **item 2**: the second.',
            '',
          ].join('\n'),
        )}
      />,
    );
    expect([...page.querySelectorAll('.lo-glossary dt')].map((dt) => dt.textContent)).toEqual([
      'bucket',
      'Cost',
      'item 2',
      'item 10',
      'page size',
      'weight',
    ]);
    // Each definition follows its term.
    expect(page.querySelector('.lo-glossary dt + dd')?.textContent).toBe('what a caller holds.');
  });

  it('keeps the written order for terms that sort alike', () => {
    const terms = ['b', 'a', 'A'].map((name, index): Definition => ({
      name,
      key: `${name}${index}`,
      children: [],
    }));
    expect(alphabetical(terms).map((each) => each.key)).toEqual(['a1', 'A2', 'b0']);
  });
});

describe('tabs', () => {
  it('switches with ← and →, Home and End, the tab shown taking focus, its panel alone shown', () => {
    const page = render(
      <OverviewDocument
        tree={overview(
          ':::tabs\n:::tab One\nFirst.\n:::\n:::tab Two\nSecond.\n:::\n:::tab Three\nThird.\n:::\n:::\n',
        )}
      />,
    );
    const tabs = [...page.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const shown = () => ({
      selected: tabs.map((tab) => tab.getAttribute('aria-selected')),
      focusable: tabs.map((tab) => tab.tabIndex),
      panels: [...page.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
        .filter((panel) => !panel.hidden)
        .map((panel) => panel.textContent),
    });
    expect(shown()).toEqual({
      selected: ['true', 'false', 'false'],
      focusable: [0, -1, -1],
      panels: ['First.'],
    });
    focus(tabs[0]!);
    press(tabs[0]!, 'ArrowRight');
    expect(shown().panels).toEqual(['Second.']);
    expect(document.activeElement).toBe(tabs[1]);
    press(tabs[1]!, 'ArrowRight');
    press(tabs[2]!, 'ArrowRight');
    expect(shown().panels).toEqual(['First.']);
    press(tabs[0]!, 'ArrowLeft');
    expect(shown()).toEqual({
      selected: ['false', 'false', 'true'],
      focusable: [-1, -1, 0],
      panels: ['Third.'],
    });
    press(tabs[2]!, 'Home');
    expect(document.activeElement).toBe(tabs[0]);
    press(tabs[0]!, 'End');
    expect(document.activeElement).toBe(tabs[2]);
    // A modified arrow is a key of Lo's own.
    press(tabs[2]!, 'ArrowLeft', { altKey: true });
    expect(shown().panels).toEqual(['Third.']);
    click(tabs[1]!);
    expect(shown().panels).toEqual(['Second.']);

    // Each tab names its panel, and each panel its tab.
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls')!);
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }
  });
});

describe('folds', () => {
  it('opens and closes with ⏎ on its title, closed to start, as “More detail”', () => {
    const page = render(<OverviewDocument tree={overview(':::fold Why not\nBecause.\n:::\n')} />);
    const fold = page.querySelector('details')!;
    const summary = fold.querySelector('summary')!;
    expect(fold.open).toBe(false);
    expect(summary.textContent).toBe('Why notMore detail');
    focus(summary);
    press(summary, 'Enter');
    expect(fold.open).toBe(true);
    expect(fold.querySelector('.lo-fold__body')?.textContent).toBe('Because.');
    press(summary, 'Enter');
    expect(fold.open).toBe(false);
  });

  it('draws a fold inside tabs as a fold too', () => {
    const page = render(
      <OverviewDocument
        tree={overview(
          ':::tabs\n:::tab One\n:::fold Why\nBecause.\n:::\n:::\n:::tab Two\nB.\n:::\n:::\n',
        )}
      />,
    );
    expect(page.querySelector('[role="tabpanel"] details.lo-fold .lo-fold__kind')).not.toBeNull();
  });
});

/** The overview's allowlist: the renderer's, and what the document draws around it. */
const DOCUMENT: Readonly<Record<string, readonly string[]>> = {
  div: ['role', 'id', 'aria-labelledby', 'hidden', 'data-lo-block', 'tabindex'],
  nav: ['aria-label'],
  article: [],
  button: ['type', 'role', 'id', 'aria-selected', 'aria-controls', 'aria-current', 'tabindex'],
  dl: [],
  dt: ['id', 'tabindex'],
  dd: ['id'],
  figure: [],
  figcaption: [],
  b: [],
  span: ['role', 'tabindex', 'aria-describedby', 'aria-hidden'],
  details: ['data-lo-block'],
  kbd: ['aria-hidden'],
};

function allowed(element: string, attribute?: string): boolean {
  const extra = Object.hasOwn(DOCUMENT, element) ? DOCUMENT[element] : undefined;
  if (attribute === undefined)
    return Object.hasOwn(MARKDOWN_ELEMENTS, element) || extra !== undefined;
  return isMarkdownAttribute(element, attribute) || (extra?.includes(attribute) ?? false);
}

/** What a term's card may hold: text and its inline marks, with classes, and hidden key caps. */
const CARD: Readonly<Record<string, readonly string[]>> = {
  div: [],
  span: [],
  strong: [],
  em: [],
  del: [],
  code: [],
  br: [],
  sub: [],
  sup: [],
  kbd: ['aria-hidden'],
};

function cardAllowed(element: string, attribute?: string): boolean {
  if (!Object.hasOwn(CARD, element)) return false;
  return attribute === undefined || attribute === 'class' || CARD[element]!.includes(attribute);
}

/**
 * Opens each term's card in `page` in turn, by focus, and lists what any holds that the card's
 * allowlist lacks.
 */
function cardsHold(page: HTMLElement): string[] {
  const found: string[] = [];
  for (const use of page.querySelectorAll<HTMLElement>('.lo-term')) {
    focus(use);
    const shown = card();
    if (!shown) {
      found.push(`no card for ${use.textContent}`);
      continue;
    }
    found.push(...disallowed(shown, cardAllowed));
    act(() => use.blur());
  }
  return found;
}

describe('hostile overviews', () => {
  const hostile = new URL('hostile/', ARTIFACTS);
  const folders = readdirSync(hostile).filter((name) => {
    try {
      return statSync(new URL(`${name}/artifact.md`, hostile)).isFile();
    } catch {
      return false;
    }
  });

  it('there are some', () => {
    expect(folders.length).toBeGreaterThanOrEqual(8);
  });

  it.each(folders)('%s draws only what the allowlist has, and loads and runs nothing', (name) => {
    const page = render(<OverviewDocument tree={fixture(`hostile/${name}`)} />);
    const article = page.querySelector('.lo-ov')!;
    expect(disallowed(article, allowed)).toEqual([]);
    expect(article.querySelectorAll('[id]').length).toBe(
      article.querySelectorAll('[id^="lo-md"]').length,
    );
    expect(cardsHold(page)).toEqual([]);
  });

  const markdown = readdirSync(HOSTILE_MARKDOWN).filter((name) => name.endsWith('.md'));
  it.each(markdown)('Markdown’s %s, as an overview, does the same', (name) => {
    const source = readFileSync(new URL(name, HOSTILE_MARKDOWN), 'utf8');
    const page = render(
      <OverviewDocument tree={parseArtifact(`${HEADER}## tl;dr\n\nA.\n\n${source}`).tree} />,
    );
    expect(disallowed(page, allowed)).toEqual([]);
    expect(cardsHold(page)).toEqual([]);
  });

  it('opens a card for every term in the hostile terms overview', () => {
    const page = render(<OverviewDocument tree={fixture('hostile/terms')} />);
    expect(page.querySelectorAll('.lo-term').length).toBeGreaterThan(0);
  });

  it('a term whose key is an object’s own name is still only a term', () => {
    const page = render(<OverviewDocument tree={fixture('hostile/terms')} />);
    focus(page.querySelector<HTMLElement>('.lo-term')!);
    expect(document.querySelector('.lo-hovercard')?.textContent).toContain('not an object');
  });
});

describe('styles', () => {
  it('uses only utilities Lo’s stylesheet has, and the design’s own classes', async () => {
    const tree = fixture('valid/example');
    const markup = renderToStaticMarkup(<OverviewDocument tree={tree} focused={1} />);
    const classes = [
      ...new Set(
        [...markup.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => (value ?? '').split(/\s+/)),
      ),
    ].filter((name) => name !== '' && !name.startsWith('lo-') && name !== 'is-focused');
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
    expect(markup).not.toMatch(/\sstyle=|<style/);
  });

  it('keeps prose’s spacing around a prose block, and a fold’s rules edge to edge, under the utilities', async () => {
    const css = await buildCss([]);
    const components = /@layer components \{\n([^]*?)\n\}\n/.exec(css)?.[1] ?? '';
    expect(components).toMatch(/\.lo-prose > \* \+ \.lo-block--prose\s*\{\s*margin-top: 14px;/);
    expect(components).toMatch(/\.lo-prose > h2 \+ \.lo-block--prose\s*\{\s*margin-top: 12px;/);
    expect(components).toMatch(/\.lo-block--fold\s*\{\s*border-radius: 0;/);
    expect(components).toMatch(
      /\.lo-block--fold\.is-focused > summary > \.lo-block__hints\s*\{\s*display: flex;/,
    );
    expect(components).toMatch(/\.lo-popover\s*\{[^}]*var\(--lo-bg-overlay\)/);
    expect(components).toMatch(/\.lo-hovercard__foot\s*\{/);
  });
});

/** What `Tab` can reach on the page. */
function tabbable(): Element[] {
  return [...document.querySelectorAll('[tabindex="0"], a[href], button, summary')];
}

/** The glossary block of `tree`. */
function glossaryOf(tree: OverviewTree): GlossaryBlock {
  const found = tree.blocks.find((block): block is GlossaryBlock => block.kind === 'glossary');
  if (!found) throw new Error('The overview has no glossary.');
  return found;
}

/** The paragraphs of an overview whose tl;dr is followed by `markdown`, findings or none. */
function paragraphsOf(markdown: string): OverviewBlock[] {
  return parseArtifact(`${HEADER}## tl;dr\n\nWhat it does.\n\n${markdown}`).tree.blocks.filter(
    (block) => block.kind === 'paragraph',
  );
}

/** The link in `page` whose text is `words`. */
function linkSaying(page: HTMLElement, words: string): HTMLElement {
  const found = [...page.querySelectorAll<HTMLElement>('a')].find(
    (each) => each.textContent === words,
  );
  if (!found) throw new Error(`No link says ${words}.`);
  return found;
}

/** The pointer moving from `from` onto `to`, as the browser tells React. */
function move(from: Element, to: Element): void {
  act(() => {
    from.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: from }));
  });
}

/** A focused block's chip, each hint as its keys and words. */
function hints(block: Element): string[] {
  return [...block.querySelectorAll('.lo-block__hints > span')].map((hint) =>
    [...hint.querySelectorAll('kbd')]
      .map((key) => key.textContent)
      .concat(hint.lastChild?.textContent ?? '')
      .join(' '),
  );
}
