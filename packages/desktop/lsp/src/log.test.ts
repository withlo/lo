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
