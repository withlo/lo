import { type CancellationToken } from 'vscode-jsonrpc';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { type Ask, Queue, type QueueLimits } from './queue.ts';

interface Sent {
  readonly token: CancellationToken;
  readonly answer: (value: unknown) => void;
}

/** A queue whose server never answers on its own, and what it was sent. */
function queueOf(limits: Partial<QueueLimits>): { queue: Queue; sent: Sent[] } {
  const sent: Sent[] = [];
  const queue = new Queue(
    (_method, _params, token) =>
      new Promise((answer) => {
        sent.push({ token, answer });
      }),
    { missed: () => undefined, answered: () => undefined },
    limits,
  );
  return { queue, sent };
}

function hover(deadline: number): Ask {
  return { method: 'textDocument/hover', params: {}, deadline };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('a request given up on keeps its place until the server answers it', async () => {
  const { queue, sent } = queueOf({ inFlight: 2, unanswered: 8 });
  const given = Array.from({ length: 10 }, () => queue.ask(hover(10)));
  await vi.advanceTimersByTimeAsync(10);
  expect(await Promise.all(given)).toEqual(
    Array.from({ length: 10 }, () => ({ ok: false, why: 'deadline' })),
  );
  // The two sent were cancelled at the server, and nothing more was sent while it has them.
  expect(sent.map(({ token }) => token.isCancellationRequested)).toEqual([true, true]);
  void queue.ask(hover(60_000));
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(2);
  // The server answers one late, and its place goes to the next.
  sent[0]?.answer(null);
  await vi.advanceTimersByTimeAsync(0);
  expect(sent).toHaveLength(3);
});

test('places given up on free in time, but a server never has more unanswered than the limit', async () => {
  const { queue, sent } = queueOf({ inFlight: 2, unanswered: 3, givenUp: 1000 });
  void queue.ask(hover(10));
  void queue.ask(hover(10));
  for (let waiting = 0; waiting < 5; waiting += 1) void queue.ask(hover(60_000));
  await vi.advanceTimersByTimeAsync(10);
  expect(sent).toHaveLength(2);
  // Both given up on long enough: one more is sent, which makes three unanswered.
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(sent).toHaveLength(3);
  sent[0]?.answer(null);
  await vi.advanceTimersByTimeAsync(0);
  expect(sent).toHaveLength(4);
});
