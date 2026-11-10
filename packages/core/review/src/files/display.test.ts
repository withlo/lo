import { expect, test } from 'vitest';

import type { ChangedFile } from './changed.ts';
import {
  binaryText,
  collapsedDetail,
  collapsedLabel,
  initialCollapse,
  isLarge,
  MAX_LINE_BYTES,
  MAX_SHOWN_BYTES,
  sizeText,
  tooLargeToShow,
} from './display.ts';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

test('past fifty mebibytes or with a mebibyte long line a file is too large to show', () => {
  expect(tooLargeToShow(MAX_SHOWN_BYTES, [])).toBeUndefined();
  expect(tooLargeToShow(MAX_SHOWN_BYTES + 1024 * 1024, [])).toBe(
    '51.0 MiB, more than the 50 MiB Lo shows',
  );
  const line = new Uint8Array(MAX_LINE_BYTES).fill(0x78);
  expect(tooLargeToShow(undefined, [line, encode('short\n')])).toBeUndefined();
  const longer = new Uint8Array([...line, ...encode('x\nshort\n')]);
  expect(tooLargeToShow(undefined, [encode('short\n'), longer])).toBe(
    'it has a line over 1 MiB long',
  );
});

function file(path: string, changedLines: number, size: number | undefined): ChangedFile {
  return { path, additions: changedLines, deletions: 0, binary: false, size };
}

test('generated files and lockfiles start collapsed saying which', () => {
  const attribute = initialCollapse(
    { ...file('api.pb.go', 10, undefined), linguistGenerated: true },
    true,
  );
  expect(attribute).toEqual({ kind: 'generated', generated: 'attribute' });
  expect(attribute && collapsedLabel(attribute, '⌥A')).toBe('generated');

  const lockfile = initialCollapse(file('Cargo.lock', 10, undefined), true);
  expect(lockfile && collapsedLabel(lockfile, '⌥A')).toBe('lockfile');

  expect(initialCollapse(file('src/lib.ts', 10, undefined), true)).toBeUndefined();
});

test('large files start collapsed and say which key loads them', () => {
  const large = initialCollapse(file('data.txt', 9_000, undefined), true);
  expect(large && isLarge(large)).toBe(true);
  expect(large && collapsedLabel(large, '⌥A')).toBe('large: load with ⌥A');
  expect(large && collapsedDetail(large, '⌥A')).toBe(
    "This file isn't loaded: 9000 lines added and 0 deleted, more than the 5000 Lo loads at " +
      'once. ⌥A loads it.',
  );

  const largeLockfile = initialCollapse(file('Cargo.lock', 9_000, undefined), true);
  expect(largeLockfile && collapsedLabel(largeLockfile, '⌥A')).toBe(
    'lockfile, large: load with ⌥A',
  );

  const heavy = initialCollapse(file('app.min.js', 1, 2 * 1024 * 1024), true);
  expect(heavy).toEqual({
    kind: 'large',
    generated: undefined,
    why: '2.0 MiB, more than the 1 MiB Lo loads at once',
  });
});

function binary(path: string): ChangedFile {
  return { ...file(path, 0, 9 * 1024 * 1024), binary: true };
}

test('a large binary file that loads nothing isnt collapsed', () => {
  expect(initialCollapse(binary('data.bin'), false)).toBeUndefined();
  expect(initialCollapse(binary('bun.lockb'), false)).toEqual({
    kind: 'generated',
    generated: 'lockfile',
  });
});

test('sizes read in the largest whole unit', () => {
  expect(sizeText(0)).toBe('0 B');
  expect(sizeText(1023)).toBe('1023 B');
  expect(sizeText(1024)).toBe('1.0 KiB');
  expect(sizeText(2150)).toBe('2.1 KiB');
  expect(sizeText(3 * 1024 * 1024 + 400_000)).toBe('3.4 MiB');
});

test('a size halfway between two tenths rounds to the even one', () => {
  expect(sizeText(1280)).toBe('1.2 KiB');
  expect(sizeText(1792)).toBe('1.8 KiB');
  expect(sizeText(1382)).toBe('1.3 KiB');
  expect(sizeText(1.25 * 1024 * 1024)).toBe('1.2 MiB');
});

test('binary files say they changed and their sizes', () => {
  expect(binaryText(2150, 4096)).toBe('(binary file changed: 2.1 KiB → 4.0 KiB)');
  expect(binaryText(undefined, 10)).toBe('(binary file added: 10 B)');
  expect(binaryText(10, undefined)).toBe('(binary file deleted: 10 B)');
});
