import { expect, test } from 'vitest';

import { LINE_LENGTH, Log, LOG_LINES } from './log.ts';

test('the log keeps the last lines, as plain text', () => {
  const log = new Log();
  for (let line = 0; line < LOG_LINES + 5; line += 1) log.add(`line ${line}`);
  expect(log.lines).toHaveLength(LOG_LINES);
  expect(log.lines[0]).toBe('line 5');
  log.add('\u001b[31mred\u001b[0m and a bell\u0007\tend\n');
  expect(log.lines.at(-1)).toBe('red and a bell\tend');
  log.add('x'.repeat(LINE_LENGTH + 10));
  expect(log.lines.at(-1)).toBe(`${'x'.repeat(LINE_LENGTH)} … (cut)`);
});

test('a stream’s line waits until it ends', () => {
  const log = new Log();
  log.write('one\r\ntw');
  expect(log.lines).toEqual(['one']);
  log.write('o\nthr');
  expect(log.lines).toEqual(['one', 'two']);
  log.end();
  expect(log.lines).toEqual(['one', 'two', 'thr']);
  // A line that never ends is kept in pieces.
  log.write('y'.repeat(LINE_LENGTH * 2 + 1));
  expect(log.lines.slice(3)).toEqual(['y'.repeat(LINE_LENGTH), 'y'.repeat(LINE_LENGTH)]);
});

test('many lines at once leave the log as they would one at a time, and are counted', () => {
  const lines = Array.from({ length: LOG_LINES * 3 }, (_, line) => `line ${line}`);
  for (const count of [3, LOG_LINES - 1, LOG_LINES, LOG_LINES + 1, LOG_LINES * 3]) {
    const text = `${lines.slice(0, count).join('\r\n')}\r\nheld`;
    const once = new Log();
    once.write('the first ');
    const apart = new Log();
    apart.write('the first ');
    expect(once.write(text)).toBe(count);
    for (const piece of text.split(/(?<=\n)/)) apart.write(piece);
    expect(once.lines).toEqual(apart.lines);
    expect(once.lines.at(-1)).toBe(`line ${count - 1}`);
    once.end();
    expect(once.lines.at(-1)).toBe('held');
  }
  // The line held back joins the first that ends.
  const log = new Log();
  log.write('the first ');
  log.write('line\n');
  expect(log.lines).toEqual(['the first line']);
  // A message of many lines leaves its last.
  log.add(`${'\n'.repeat(LOG_LINES * 2)}last\n`);
  expect(log.lines).toEqual([...Array<string>(LOG_LINES - 1).fill(''), 'last']);
});
