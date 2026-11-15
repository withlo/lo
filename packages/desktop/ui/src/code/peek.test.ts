// @vitest-environment jsdom
import tokenNames from '@lo/design/syntax.json' with { type: 'json' };
import { beforeAll, describe, expect, test, vi } from 'vitest';

import { findScope, isKeySource } from '../commands/index.ts';
import type { PeekCode, PeekFrame, PeekView } from './api.ts';
import { PeekBlock, peekLines } from './peek.ts';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const at = { file: 'a', side: 'new', line: 34, column: 17 } as const;

/** A peek at definitions of `estimateCost`, the first shown, its code lines 14 to 20. */
function definitions(more: Partial<PeekView> = {}): PeekView {
  return {
    label: 'Definitions of estimateCost',
    answers: [
      { path: 'src/cost/estimate.ts', line: 18, column: 16, source: 'server', label: 'TypeScript' },
      { path: 'test/cost.ts', line: 7, source: 'syntax', label: 'Syntax index · same name' },
    ],
    shown: 0,
    code: {
      first: 14,
      lines: [
        '/**',
        ' * Adds up a query’s cost.',
        ' */',
        '',
        'export function estimateCost(',
        '  schema: GraphQLSchema,',
        '): CostReport {',
      ],
    },
    ...more,
  };
}

/** The code a peek shows: each line's number and text, marked `>` on its answer's line. */
function code(block: PeekBlock): string[] {
  const cells = [...block.dom.querySelectorAll('.lo-diffpeek__code .lo-uni > *')];
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 2) {
    const number = cells[index]!;
    const marked = number.classList.contains('is-active') ? '>' : ' ';
    rows.push(`${marked}${number.textContent} ${cells[index + 1]!.textContent}`);
  }
  return rows;
}

/** A frame that draws what it's given in each part, and says what it was asked. */
function framed() {
  const asked: string[] = [];
  const frame: PeekFrame = (parts, peek) => {
    const draw = (shown: PeekView): void => {
      parts.head.textContent = shown.label;
      parts.list.textContent = shown.answers.map((answer) => answer.path).join(', ');
      parts.foot.textContent = `${shown.shown + 1} of ${shown.answers.length}`;
    };
    asked.push('draw');
    draw(peek);
    return {
      update(next) {
        asked.push('update');
        draw(next);
      },
      destroy() {
        asked.push('destroy');
      },
    };
  };
  return { frame, asked };
}

/** Code of `count` lines. */
function lines(count: number): PeekCode {
  return { first: 1, lines: Array.from({ length: count }, () => 'x') };
}

/** Presses `key` in `target`: whether something prevented what it does by default. */
function pressed(target: Element, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('a peek', () => {
  test("draws its answer's code, numbered from its first line, its line and name marked", () => {
    const keyword = tokenNames.indexOf('keyword');
    // `export` and `function` on line 18, which starts 36 characters in.
    const tokens = Uint32Array.of(36, 42, keyword, 43, 51, keyword);
    const block = new PeekBlock(
      at,
      definitions({ code: { ...definitions().code!, tokens } }),
      undefined,
    );
    expect(code(block)).toEqual([
      ' 14 /**',
      ' 15  * Adds up a query’s cost.',
      ' 16  */',
      ' 17 ',
      '>18 export function estimateCost(',
      ' 19   schema: GraphQLSchema,',
      ' 20 ): CostReport {',
    ]);
    expect(block.dom.querySelector('.lo-line-active')?.textContent).toBe(
      'export function estimateCost(',
    );
    expect(block.dom.querySelector('.lo-diffpeek__name')?.textContent).toBe('estimateCost');
    expect(
      [...block.dom.querySelectorAll('.lo-syn-keyword')].map((each) => each.textContent),
    ).toEqual(['export', 'function']);
    // A line wraps under its own indent.
    const texts = block.dom.querySelectorAll<HTMLElement>('.lo-line');
    expect(texts[5]!.style.getPropertyValue('--ind')).toBe('2');
    expect(block.dom.getAttribute('aria-label')).toBe('Definitions of estimateCost');
    block.destroy();
  });

  test('draws its frame in its parts at once, again as what it shows changes, and takes it down', () => {
    const { frame, asked } = framed();
    const block = new PeekBlock(at, definitions(), frame);
    const part = (name: string): string | null =>
      block.dom.querySelector(`.lo-diffpeek__${name}`)!.textContent;
    expect(asked).toEqual(['draw']);
    expect([part('head'), part('list'), part('foot')]).toEqual([
      'Definitions of estimateCost',
      'src/cost/estimate.ts, test/cost.ts',
      '1 of 2',
    ]);
    const second = definitions({
      shown: 1,
      code: { first: 5, lines: ['', '', 'function estimateCost() {}'] },
    });
    block.update(second);
    expect(asked).toEqual(['draw', 'update']);
    expect(part('foot')).toBe('2 of 2');
    expect(code(block)).toEqual([' 5 ', ' 6 ', '>7 function estimateCost() {}']);
    block.destroy();
    expect(asked).toEqual(['draw', 'update', 'destroy']);
  });

  test('with one answer, it has no list; without a frame, no parts', () => {
    const one = definitions({ answers: definitions().answers.slice(0, 1) });
    const block = new PeekBlock(at, one, framed().frame);
    expect(block.dom.classList).toContain('lo-diffpeek--single');
    block.update(definitions());
    expect(block.dom.classList).not.toContain('lo-diffpeek--single');
    const bare = new PeekBlock(at, definitions(), undefined);
    for (const name of ['head', 'list', 'foot']) {
      expect(bare.dom.querySelector<HTMLElement>(`.lo-diffpeek__${name}`)!.hidden).toBe(true);
    }
    // No code, as for an answer outside the repository, whose frame says why.
    bare.update(definitions({ code: undefined }));
    expect(code(bare)).toEqual([]);
  });

  test('is as tall as its code, at most 15 lines, and 6 beside a list, whatever its frame draws', () => {
    const one = definitions().answers.slice(0, 1);
    expect(peekLines(definitions({ answers: one, code: lines(3) }))).toBe(3);
    expect(peekLines(definitions({ answers: one, code: lines(30) }))).toBe(15);
    expect(peekLines(definitions({ answers: one, code: undefined }))).toBe(1);
    expect(peekLines(definitions({ code: lines(3) }))).toBe(6);
    expect(peekLines(definitions({ code: lines(9) }))).toBe(9);
    const block = new PeekBlock(at, definitions({ answers: one, code: lines(3) }), undefined);
    const body = block.dom.querySelector<HTMLElement>('.lo-diffpeek__body')!;
    expect(body.style.getPropertyValue('--lo-diffpeek-lines')).toBe('3');
    // Says whether showing another answer changes its height.
    expect(block.update(definitions({ answers: one, code: lines(3) }))).toBe(false);
    expect(block.update(definitions({ answers: one, code: lines(20) }))).toBe(true);
    expect(body.style.getPropertyValue('--lo-diffpeek-lines')).toBe('15');
  });

  test('is a scope of its own, with no Vim, whose keys act on the line it’s under', () => {
    const block = new PeekBlock(at, definitions(), undefined);
    document.body.append(block.dom);
    const scope = findScope(block.dom);
    expect(scope.name).toBe('peek');
    expect(isKeySource(scope.source)).toBe(true);
    expect(block.keyState()).toEqual({
      mode: 'normal',
      pending: false,
      target: { kind: 'line', at },
    });
    block.destroy();
    expect(findScope(block.dom).source).toBeUndefined();
  });

  test('a key that scrolls, which nothing in it took, scrolls its code and goes no further', () => {
    const { frame } = framed();
    const block = new PeekBlock(at, definitions({ code: lines(60) }), frame);
    // In an editor's text, as a block between its lines.
    const editor = document.body.appendChild(document.createElement('div'));
    editor.contentEditable = 'true';
    const holder = editor.appendChild(document.createElement('div'));
    holder.contentEditable = 'false';
    block.attach(holder);
    for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End']) {
      expect(pressed(block.dom, key)).toBe(true);
    }
    // In the frame too, short of a button's Space.
    const list = block.dom.querySelector('.lo-diffpeek__list')!;
    const button = list.appendChild(document.createElement('button'));
    expect(pressed(list, 'PageDown')).toBe(true);
    expect(pressed(button, 'ArrowDown')).toBe(true);
    expect(pressed(button, ' ')).toBe(false);
    // Others, and those the frame handles itself, are left alone.
    expect(pressed(block.dom, 'x')).toBe(false);
    list.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    const spied = vi.spyOn(block.dom.querySelector('.lo-diffpeek__code')!, 'scrollTop', 'set');
    expect(pressed(list, 'ArrowDown')).toBe(true);
    expect(spied).not.toHaveBeenCalled();
    expect(pressed(block.dom, 'End')).toBe(true);
    expect(spied).toHaveBeenCalled();
    block.destroy();
    editor.remove();
  });

  test('what its frame draws keeps the keys it uses, and the browser scrolls with none of the rest', () => {
    const block = new PeekBlock(at, definitions({ code: lines(60) }), framed().frame);
    document.body.append(block.dom);
    const list = block.dom.querySelector('.lo-diffpeek__list')!;
    const scroller = block.dom.querySelector('.lo-diffpeek__code')!;
    const scrolled = vi.spyOn(scroller, 'scrollTop', 'set');
    const drawn = <K extends keyof HTMLElementTagNameMap>(tag: K, role?: string) => {
      const element = list.appendChild(document.createElement(tag));
      if (role) element.setAttribute('role', role);
      return element;
    };
    // Space presses a link, or what's pressed or picked, as a button does: it never scrolls.
    const link = drawn('a');
    link.href = '#definition';
    for (const element of [link, drawn('div', 'button'), drawn('div', 'option')]) {
      expect(pressed(element, ' ')).toBe(true);
    }
    expect(scrolled).not.toHaveBeenCalled();
    // A field keeps what it types and moves its caret with, and leaves no key to scroll with.
    const field = drawn('input');
    const box = drawn('textarea');
    for (const key of [' ', 'ArrowLeft', 'ArrowRight']) expect(pressed(field, key)).toBe(false);
    for (const key of ['ArrowUp', 'ArrowDown']) expect(pressed(box, key)).toBe(false);
    for (const element of [field, box]) {
      for (const key of ['PageDown', 'PageUp', 'Home', 'End']) {
        expect(pressed(element, key)).toBe(true);
      }
    }
    expect(scrolled).not.toHaveBeenCalled();
    // Home and End, and up and down a line of one, go to its ends.
    field.value = 'estimateCost';
    field.setSelectionRange(4, 4);
    pressed(field, 'End');
    expect([field.selectionStart, field.selectionEnd]).toEqual([12, 12]);
    pressed(field, 'ArrowUp');
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 0]);
    box.value = 'one\ntwo three\nfour';
    box.setSelectionRange(6, 6);
    pressed(box, 'Home', { shiftKey: true });
    expect([box.selectionStart, box.selectionEnd, box.selectionDirection]).toEqual([
      4,
      6,
      'backward',
    ]);
    pressed(box, 'End');
    expect([box.selectionStart, box.selectionEnd]).toEqual([13, 13]);
    // A box to tick takes Space; a list to pick from, every key.
    const tick = drawn('input');
    tick.type = 'checkbox';
    expect(pressed(tick, ' ')).toBe(false);
    expect(pressed(drawn('select'), 'PageDown')).toBe(false);
    block.destroy();
  });

  test('moved into another block, it keeps focus, without scrolling to it', async () => {
    const block = new PeekBlock(at, definitions(), undefined);
    const first = document.createElement('div');
    document.body.append(first);
    block.attach(first);
    const focused = vi.spyOn(block.dom, 'focus');
    block.focus();
    expect(focused).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(block.hasFocus).toBe(true);
    const second = document.createElement('div');
    block.attach(second);
    // Not in the page until its editor puts the block there.
    document.body.append(second);
    expect(block.hasFocus).toBe(true);
    await Promise.resolve();
    expect(document.activeElement).toBe(block.dom);
    block.destroy();
  });
});
