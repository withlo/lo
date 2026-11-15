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
