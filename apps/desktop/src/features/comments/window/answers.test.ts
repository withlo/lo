// What main said on a topic of something the window asked, against main's answer: once the answer
// is heard, what main said before it that comes after changes nothing, until what main said with
// its answer comes.

import { describe, expect, test } from 'vitest';

import { Answers } from './answers.ts';

/** A value main sent that shows `keys` on their way, and every other key not. */
function onWay(...keys: string[]): (key: string) => boolean {
  return (key) => keys.includes(key);
}

describe('an answer', () => {
  test('heard after what main said with it holds nothing', () => {
    const answers = new Answers();
    const asked = answers.ask('T1');
    expect(answers.take(onWay('T1'))).toEqual(new Set());
    expect(answers.take(onWay())).toEqual(new Set());
    expect(answers.answered(asked, true)).toBe(false);
    expect(answers.take(onWay('T1'))).toEqual(new Set());
  });

  test('heard first, what main said before it is older, up to what it said with it', () => {
    const answers = new Answers();
    expect(answers.answered(answers.ask('T1'), true)).toBe(true);
    // Sent before main said it was on its way, as an earlier change elsewhere.
    expect(answers.take(onWay('T2'))).toEqual(new Set(['T1']));
    expect(answers.take(onWay('T1'))).toEqual(new Set(['T1']));
    expect(answers.take(onWay('T1', 'T2'))).toEqual(new Set(['T1']));
    // What main said with its answer is newer than nothing heard, and so is all that follows.
    expect(answers.take(onWay())).toEqual(new Set());
    expect(answers.take(onWay('T1'))).toEqual(new Set());
  });

  test('heard while it was on its way, what main said before it is older, up to what it said with it', () => {
    const answers = new Answers();
    const asked = answers.ask('T1');
    expect(answers.take(onWay('T1'))).toEqual(new Set());
    expect(answers.answered(asked, true)).toBe(true);
    expect(answers.take(onWay('T1'))).toEqual(new Set(['T1']));
    expect(answers.take(onWay())).toEqual(new Set());
  });

  test('one main gave at once, or one lost, holds nothing', () => {
    const answers = new Answers();
    expect(answers.answered(answers.ask('T1'), false)).toBe(false);
    expect(answers.take(onWay('T1'))).toEqual(new Set());
    expect(answers.take(onWay())).toEqual(new Set());
  });

  test('each key is held alone', () => {
    const answers = new Answers();
    const first = answers.ask('T1');
    const second = answers.ask('T2');
    answers.answered(first, true);
    expect(answers.take(onWay('T1', 'T2'))).toEqual(new Set(['T1']));
    expect(answers.take(onWay('T2'))).toEqual(new Set());
    answers.answered(second, true);
    expect(answers.take(onWay('T2'))).toEqual(new Set(['T2']));
    expect(answers.take(onWay())).toEqual(new Set());
  });

  test('asked again before what main said of the last comes, the last is held to its end, then the next is taken', () => {
    const answers = new Answers();
    answers.answered(answers.ask('T1'), true);
    const again = answers.ask('T1');
    // The first ask's, on its way, then done.
    expect(answers.take(onWay('T1'))).toEqual(new Set(['T1']));
    expect(answers.take(onWay())).toEqual(new Set());
    // The second's, as it comes.
    expect(answers.take(onWay('T1'))).toEqual(new Set());
    expect(answers.answered(again, true)).toBe(true);
    expect(answers.take(onWay('T1'))).toEqual(new Set(['T1']));
    expect(answers.take(onWay())).toEqual(new Set());
    expect(answers.take(onWay('T1'))).toEqual(new Set());
  });

  test('to one asked again while the first is on its way, refused at once, holds nothing of the first', () => {
    const answers = new Answers();
    const first = answers.ask('T1');
    expect(answers.take(onWay('T1'))).toEqual(new Set());
    // Asked again as the window hadn't heard it was on its way yet: main says it's busy, at once.
    expect(answers.answered(answers.ask('T1'), false)).toBe(false);
    expect(answers.take(onWay())).toEqual(new Set());
    // The first's answer, after all it said came: nothing's held, and the next ask's is taken.
    expect(answers.answered(first, true)).toBe(false);
    answers.ask('T1');
    expect(answers.take(onWay('T1'))).toEqual(new Set());
  });
});
