// The question main asks in the window: only the reader's answer to it, by its id, from the window
// it was asked in, counts; anything else ends it as Cancel, and one question is up at a time.

import { describe, expect, it } from 'vitest';

import type { Question } from '../contract.ts';
import { Questions, type QuestionWindow } from './questions.ts';

const REPLACE = {
  title: 'Replace Lo in Applications?',
  detail: 'The copy in Applications moves to the Trash. This copy takes its place and restarts.',
  action: 'Replace Lo',
};

/** A window the test can close. */
class TestWindow implements QuestionWindow {
  readonly listeners = new Set<() => void>();
  onClosed(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Questions asked in window 1, the one window open, with what each told the window. */
function start() {
  const window = new TestWindow();
  const published: (Question | null)[] = [];
  let ids = 0;
  const questions = new Questions({
    window: (id) => (id === 1 ? window : undefined),
    publish: (question) => published.push(question),
    newId: () => `q${++ids}`,
  });
  return { questions, window, published };
}

/** Whether `promise` has settled, once what's queued has run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
}

describe('Questions', () => {
  it('asks in the window and answers what the reader pressed, then takes the question down', async () => {
    const { questions, published } = start();
    const replaced = questions.ask(1, REPLACE);
    expect(questions.current).toEqual({ ...REPLACE, id: 'q1' });
    expect(published).toEqual([{ ...REPLACE, id: 'q1' }]);
    questions.answer(1, 'q1', true);
    await expect(replaced).resolves.toBe(true);
    expect(questions.current).toBeNull();
    expect(published).toEqual([{ ...REPLACE, id: 'q1' }, null]);

    const cancelled = questions.ask(1, REPLACE);
    questions.answer(1, 'q2', false);
    await expect(cancelled).resolves.toBe(false);
  });

  it('ignores an answer to a question it never asked, or from another window', async () => {
    const { questions, window } = start();
    const asked = questions.ask(1, REPLACE);
    questions.answer(1, 'q0', true);
    questions.answer(1, 'q2', true);
    questions.answer(2, 'q1', true);
    questions.answer(undefined, 'q1', true);
    expect(await settled(asked)).toBe(false);
    expect(questions.current?.id).toBe('q1');
    // Nor, once it's answered, does a second answer to it count for the next.
    questions.answer(1, 'q1', false);
    await expect(asked).resolves.toBe(false);
    const next = questions.ask(1, REPLACE);
    questions.answer(1, 'q1', true);
    expect(await settled(next)).toBe(false);
    window.close();
    await expect(next).resolves.toBe(false);
  });

  it('is Cancel with no window to ask in, and asks nothing', async () => {
    const { questions, published } = start();
    await expect(questions.ask(undefined, REPLACE)).resolves.toBe(false);
    await expect(questions.ask(2, REPLACE)).resolves.toBe(false);
    expect(published).toEqual([]);
  });

  it('is Cancel once the window closes, the asker gives up, or Lo quits', async () => {
    const { questions, window, published } = start();
    const closed = questions.ask(1, REPLACE);
    window.close();
    await expect(closed).resolves.toBe(false);
    expect(window.listeners.size).toBe(0);

    const giveUp = new AbortController();
    const given = questions.ask(1, REPLACE, giveUp.signal);
    giveUp.abort();
    await expect(given).resolves.toBe(false);
    await expect(questions.ask(1, REPLACE, giveUp.signal)).resolves.toBe(false);

    const quitting = questions.ask(1, REPLACE);
    questions.stop();
    await expect(quitting).resolves.toBe(false);
    expect(questions.current).toBeNull();
    expect(published).toEqual([
      { ...REPLACE, id: 'q1' },
      null,
      { ...REPLACE, id: 'q2' },
      null,
      { ...REPLACE, id: 'q3' },
      null,
    ]);
  });

  it('fails a question the window can’t be told, which holds up no question after it', async () => {
    const window = new TestWindow();
    let refuse = true;
    const questions = new Questions({
      window: () => window,
      publish: (question) => {
        if (refuse && question !== null) throw new Error('A question the schema refuses.');
      },
      newId: () => 'q1',
    });
    await expect(questions.ask(1, REPLACE)).rejects.toThrow('A question the schema refuses.');
    expect(questions.current).toBeNull();
    expect(window.listeners.size).toBe(0);
    refuse = false;
    const asked = questions.ask(1, REPLACE);
    questions.answer(1, 'q1', true);
    await expect(asked).resolves.toBe(true);
  });

  it('asks one question at a time: one asked meanwhile is Cancel, and the first stays up', async () => {
    const { questions } = start();
    const first = questions.ask(1, REPLACE);
    await expect(questions.ask(1, { ...REPLACE, title: 'Another?' })).resolves.toBe(false);
    expect(questions.current).toEqual({ ...REPLACE, id: 'q1' });
    questions.answer(1, 'q1', true);
    await expect(first).resolves.toBe(true);
  });
});
