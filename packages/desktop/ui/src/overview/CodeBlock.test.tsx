// @vitest-environment jsdom
// An overview's code blocks and walkthroughs as drawn around their code: a block's head names the
// file and lines and its body is as tall as its lines from the start; what it says in the code's
// place, with what the reader can do; a plain fenced block, drawn as an illustration; a
// walkthrough's steps, which the reader moves through; and a held block, cut off while its
// contents grow on screen, until the reader asks to see it whole.

import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseArtifact, type CodeRange } from '@lo/artifact';

import { cleanUp, click, render, rerender } from '../../test/dom.ts';
import { FakeResizeObserver, resize } from '../../test/figures.ts';
import {
  CodeBlock,
  CodeBody,
  CodeFlag,
  CodeNote,
  Held,
  OutOfDate,
  OverviewDocument,
  Walkthrough,
} from './index.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const HEADER = '---\nformat: 1\npr: 1\ncommit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87\n---\n\n';

function tree(markdown: string) {
  return parseArtifact(`${HEADER}## tl;dr\n\nWhat it does.\n\n${markdown}`).tree;
}

const TARGET: CodeRange = { kind: 'code', path: 'src/cache/lru.ts', lines: { start: 12, end: 44 } };

describe('a code block', () => {
  it('names the file and lines it shows, and is as tall as them from the start', () => {
    const page = render(
      <CodeBlock target={TARGET}>
        <CodeBody rows={33} />
      </CodeBlock>,
    );
    expect(page.querySelector('.lo-codeblock')?.className).toBe('lo-codeblock');
    expect(page.querySelector('.lo-codeblock__path')?.textContent).toBe('src/cache/lru.ts');
    expect(page.querySelector('.lo-codeblock__path b')?.textContent).toBe('lru.ts');
    expect(page.querySelector('.lo-codeblock__lines')?.textContent).toBe('L12–44');
    // Its room is an excerpt's frame of as many empty lines, drawn by the code views' own rules.
    const space = page.querySelector('.lo-codeblock__body > .lo-codeblock__space')!;
    expect(
      space.querySelectorAll('.lo-excerpt .cm-editor .cm-scroller .cm-content > .cm-line'),
    ).toHaveLength(33);
    expect(space.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('flags lines that changed since under its head, over its code, with the way to compare', () => {
    const page = render(
      <CodeBlock
        target={TARGET}
        flag={<CodeFlag action={<button>Compare r3 → r5</button>}>Line 12 changed in r5.</CodeFlag>}
      >
        <CodeBody rows={4} />
      </CodeBlock>,
    );
    const block = page.querySelector('.lo-codeblock')!;
    expect([...block.children].map((child) => child.className)).toEqual([
      'lo-codeblock__head',
      'lo-codeblock__flag',
      'lo-codeblock__body',
    ]);
    const flag = block.querySelector('.lo-codeblock__flag')!;
    expect(flag.getAttribute('role')).toBe('note');
    expect(flag.querySelector('.lo-codeblock__flagtext')?.textContent).toBe(
      'Line 12 changed in r5.',
    );
    expect(flag.querySelector('button')?.textContent).toBe('Compare r3 → r5');
  });

  it('keeps what the reader can do in its head, whatever its body holds', () => {
    const page = render(
      <CodeBlock target={TARGET} variant="unresolved" actions={<button>Find</button>}>
        <CodeBody rows={4} />
      </CodeBlock>,
    );
    expect(
      page.querySelector('.lo-codeblock__head .lo-codeblock__actions button')?.textContent,
    ).toBe('Find');
    rerender(
      page,
      <CodeBlock target={TARGET}>
        <CodeBody rows={4} />
      </CodeBlock>,
    );
    expect(page.querySelector('.lo-codeblock__actions')).toBeNull();
  });

  it('says why in the code’s place, framed for what went wrong, with what the reader can do', () => {
    const page = render(
      <CodeBlock target={TARGET} variant="unresolved">
        <CodeBody rows={1}>
          <CodeNote title="This reference doesn’t resolve." action={<button>Find</button>}>
            There’s no file.
          </CodeNote>
        </CodeBody>
      </CodeBlock>,
    );
    expect(page.querySelector('.lo-codeblock')?.className).toBe(
      'lo-codeblock lo-codeblock--unresolved',
    );
    const note = page.querySelector('.lo-codeblock__msg')!;
    expect(note.querySelector('strong')?.textContent).toBe('This reference doesn’t resolve.');
    expect(note.textContent).toContain('There’s no file.');
    expect(note.querySelector('button')?.textContent).toBe('Find');
    rerender(
      page,
      <CodeBlock target={TARGET} variant="missing">
        <CodeNote title="Gone." />
      </CodeBlock>,
    );
    expect(page.querySelector('.lo-codeblock--missing')).not.toBeNull();
  });
});

describe('a plain fenced block', () => {
  it('draws as an illustration, labeled, as it is, with no line numbers', () => {
    const page = render(
      <OverviewDocument tree={tree('```ts\nconst a = 1;\n  indented();\n```\n')} />,
    );
    const block = page.querySelector('.lo-codeblock--illustration')!;
    expect(block.querySelector('.lo-codeblock__head')?.textContent).toBe(
      'Illustration · not code from this PR',
    );
    expect(block.querySelector('pre')?.textContent).toBe('const a = 1;\n  indented();');
    expect(block.querySelector('.lo-codeblock__lines, .cm-gutters')).toBeNull();
  });

  it('draws as whoever shows it says, when given', () => {
    const page = render(
      <OverviewDocument
        tree={tree('```\nx\n```\n')}
        views={{ fence: (node) => <div className="fence">{node.text}</div> }}
      />,
    );
    expect(page.querySelector('.fence')?.textContent).toBe('x');
    expect(page.querySelector('.lo-codeblock--illustration')).toBeNull();
  });
});

describe('a walkthrough', () => {
  const walkthrough = tree(
    [
      ':::walkthrough Through it',
      ':::step src/a.ts#L1-L2',
      'First, [a link](https://example.com).',
      ':::',
      ':::step src/b.ts#L3',
      'Second.',
      ':::',
      ':::step src/c.ts#L4-L9',
      'Third.',
      ':::',
      ':::',
      '',
    ].join('\n'),
  );

  function drawn(current: number) {
    const step = vi.fn<(index: number) => void>();
    // Its steps' words are Markdown, which the document draws.
    const page = render(
      <OverviewDocument
        tree={walkthrough}
        views={{
          walkthrough: (node) => (
            <Walkthrough
              node={node}
              current={current}
              step={step}
              code={<div className="code" />}
            />
          ),
        }}
      />,
    );
    return { page, step };
  }

  it('shows the current step’s file and lines beside its steps, earlier ones done', () => {
    const { page } = drawn(1);
    expect(page.querySelector('.lo-walk__title')?.textContent).toBe('Through it');
    expect(page.querySelector('.lo-walk__head')?.textContent).toContain('Step 2 of 3');
    expect(page.querySelector('.lo-walk__codehead')?.textContent).toBe('src/b.tsL3');
    const steps = [...page.querySelectorAll('.lo-walk__step')];
    expect(steps.map((each) => each.className)).toEqual([
      'lo-walk__step is-done',
      'lo-walk__step',
      'lo-walk__step',
    ]);
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
    expect(page.querySelector('.lo-walk__view .code')).not.toBeNull();
  });

  it('moves by Previous and Next, which stop at the ends', () => {
    const first = drawn(0);
    const [previous, next] = first.page.querySelectorAll<HTMLButtonElement>('.lo-walk__nav button');
    expect(previous?.disabled).toBe(true);
    click(next!);
    expect(first.step).toHaveBeenCalledWith(1);
    const last = drawn(2);
    const buttons = last.page.querySelectorAll<HTMLButtonElement>('.lo-walk__nav button');
    expect(buttons[1]?.disabled).toBe(true);
    click(buttons[0]!);
    expect(last.step).toHaveBeenCalledWith(1);
  });

  it('moves to a step clicked, but not for a link in it', () => {
    const { page, step } = drawn(1);
    const steps = page.querySelectorAll('.lo-walk__step');
    click(steps[1]!.querySelector('p')!);
    expect(step).not.toHaveBeenCalled();
    const link = steps[0]!.querySelector('a')!;
    link.addEventListener('click', (event) => event.preventDefault());
    click(link);
    expect(step).not.toHaveBeenCalled();
    click(steps[2]!.querySelector('p')!);
    expect(step).toHaveBeenCalledWith(2);
  });
});

describe('a held block', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  it('cuts off contents grown on screen above a row of its own, and shows them whole when asked', () => {
    let contents = 100;
    // A screen 400 pixels tall, with more under the block, which is at its top.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('lo-ov')) return new DOMRect(0, 0, 600, 400);
      const own = this.className.startsWith('lo-held')
        ? Number.parseFloat(this.style.height)
        : contents;
      return new DOMRect(0, 10, 600, own);
    });
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400);
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(2000);
    const page = render(
      <div className="lo-ov">
        <Held>
          <div className="contents" />
        </Held>
      </div>,
    );
    const box = page.querySelector<HTMLElement>('.lo-held')!;
    expect(box.style.height).toBe('100px');
    contents = 300;
    act(() => resize(page.querySelector('.lo-held__clip > div')!));
    expect(box.className).toBe('lo-held is-cut');
    expect(box.style.height).toBe('100px');
    // The row is under what's cut off, never over it.
    expect([...box.children].map((child) => child.className)).toEqual([
      'lo-held__clip',
      'lo-held__more',
    ]);
    const more = page.querySelector('.lo-held__more button')!;
    expect(more.textContent).toBe('Show the whole block');
    click(more);
    expect(box.className).toBe('lo-held');
    expect(box.style.height).toBe('300px');
    expect(page.querySelector('.lo-held__more')).toBeNull();
  });
});

describe('the banner over an overview written for an older push', () => {
  it('has its title, the room for what changed since and its actions from the start', () => {
    const page = render(
      <OutOfDate
        title="Written for r3. The PR is at r5."
        detail=""
        actions={<button>Compare r3 → r5</button>}
      />,
    );
    const banner = page.querySelector('.lo-ov-stales > .lo-ov-stale')!;
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.querySelector('.lo-ov-stale__title')?.textContent).toBe(
      'Written for r3. The PR is at r5.',
    );
    // What changed since has its room before it comes, and the same element once it has.
    const sub = banner.querySelector('.lo-ov-stale__sub')!;
    expect(sub.textContent).toBe('');
    rerender(
      page,
      <OutOfDate
        title="Written for r3. The PR is at r5."
        detail="2 pushes since, touching 5 files."
        actions={<button>Compare r3 → r5</button>}
      />,
    );
    expect(page.querySelector('.lo-ov-stale__sub')).toBe(sub);
    expect(sub.textContent).toBe('2 pushes since, touching 5 files.');
    expect(sub.getAttribute('title')).toBe('2 pushes since, touching 5 files.');
    expect(banner.querySelector('.lo-ov-stale__actions button')?.textContent).toBe(
      'Compare r3 → r5',
    );
  });
});
