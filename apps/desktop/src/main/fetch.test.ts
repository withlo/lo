import { EventEmitter } from 'node:events';

import type { FetchInit } from '@lo/github';
import type { ClientRequestConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  AnswerTooLarge,
  netFetch,
  UPLOAD_PROGRESS_EVERY,
  type NetAnswer,
  type NetRequest,
  type NetUploadProgress,
} from './fetch.ts';

/** An answer as Electron's `net.request` gives it. */
class FakeAnswer extends EventEmitter implements NetAnswer {
  readonly statusCode: number;
  readonly statusMessage: string;
  readonly headers: Record<string, string | string[]>;

  constructor(statusCode: number, headers: Record<string, string | string[]> = {}) {
    super();
    this.statusCode = statusCode;
    this.statusMessage = '';
    this.headers = headers;
  }
}

/** A request as Electron's `net.request` makes it, which the test answers. */
class FakeRequest extends EventEmitter implements NetRequest {
  readonly options: ClientRequestConstructorOptions;
  readonly written: Buffer[] = [];
  ended = false;
  aborted = false;
  /** What `getUploadProgress` says, and how often it was asked. */
  progress: NetUploadProgress = { started: false, current: 0, total: 0 };
  progressAsked = 0;

  constructor(options: ClientRequestConstructorOptions) {
    super();
    this.options = options;
  }

  write(chunk: Buffer): void {
    this.written.push(chunk);
  }

  end(): void {
    this.ended = true;
  }

  abort(): void {
    this.aborted = true;
  }

  getUploadProgress(): NetUploadProgress {
    this.progressAsked += 1;
    return this.progress;
  }

  /** Answers with `status`, `headers` and `body`, in two chunks. */
  answer(status: number, headers: Record<string, string | string[]> = {}, body = ''): void {
    const answer = new FakeAnswer(status, headers);
    this.emit('response', answer);
    const bytes = Buffer.from(body);
    answer.emit('data', bytes.subarray(0, 2));
    answer.emit('data', bytes.subarray(2));
    answer.emit('end');
  }
}

/** A `netFetch` over fake requests, and the requests it made. */
function fake(limit?: number) {
  const sent: FakeRequest[] = [];
  const fetch = netFetch(
    (options) => {
      const request = new FakeRequest(options);
      sent.push(request);
      return request;
    },
    { limit },
  );
  /** The request made, once it has been sent whole. */
  const made = async (): Promise<FakeRequest> => {
    await expect.poll(() => sent.at(-1)?.ended).toBe(true);
    const request = sent.at(-1);
    if (!request) throw new Error('nothing was sent');
    return request;
  };
  return { fetch, sent, made };
}

describe('netFetch', () => {
  it('sends the method, address, headers and body, and reads the whole answer', async () => {
    const { fetch, made } = fake();
    const answered = fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { authorization: 'token gho_FAKE', 'content-type': 'application/json' },
      body: '{"query":"{ viewer { login } }"}',
    });
    const request = await made();
    expect(request.options).toEqual({
      method: 'POST',
      url: 'https://api.github.com/graphql',
      headers: { authorization: 'token gho_FAKE', 'content-type': 'application/json' },
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      useSessionCookies: false,
    });
    expect(Buffer.concat(request.written).toString()).toBe('{"query":"{ viewer { login } }"}');
    request.answer(200, { etag: '"e"', 'x-oauth-scopes': ['repo', 'workflow'] }, '{"ok":true}');
    const response = await answered;
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"e"');
    expect(response.headers.get('x-oauth-scopes')).toBe('repo, workflow');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('answers with a redirect asked for manually, and follows it no further', async () => {
    const { fetch, made } = fake();
    const answered = fetch('https://api.github.com/repos/old/name', { redirect: 'manual' });
    const request = await made();
    expect(request.options.redirect).toBe('manual');
    request.emit('redirect', 301, 'GET', 'https://api.github.com/repositories/1', {
      'x-github-request-id': ['1'],
    });
    const response = await answered;
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://api.github.com/repositories/1');
    expect(request.aborted).toBe(true);
  });

  it('goes on through a redirect it follows', async () => {
    const { fetch, made } = fake();
    const answered = fetch('https://api.github.com/repos/old/name');
    const request = await made();
    request.emit('redirect', 301, 'GET', 'https://api.github.com/repositories/1', {});
    request.answer(200, {}, '{"full_name":"new/name"}');
    expect(await (await answered).json()).toEqual({ full_name: 'new/name' });
    expect(request.aborted).toBe(false);
  });

  it('gives no body with a 304', async () => {
    const { fetch, made } = fake();
    const answered = fetch('https://api.github.com/repos/a/b/pulls/1', {
      headers: { 'if-none-match': '"e"' },
    });
    (await made()).answer(304, { etag: '"e"' });
    const response = await answered;
    expect([response.status, await response.text()]).toEqual([304, '']);
  });

  it("fails as Chromium's network stack does", async () => {
    const { fetch, made } = fake();
    const answered = fetch('https://api.github.com/user');
    (await made()).emit('error', new Error('net::ERR_CONNECTION_REFUSED'));
    await expect(answered).rejects.toThrow('net::ERR_CONNECTION_REFUSED');
  });

  it('fails when the connection drops mid-answer', async () => {
    const { fetch, made } = fake();
    const answered = fetch('https://api.github.com/user');
    const answer = new FakeAnswer(200);
    (await made()).emit('response', answer);
    answer.emit('data', Buffer.from('{"lo'));
    answer.emit('aborted');
    await expect(answered).rejects.toThrow('net::ERR_CONNECTION_CLOSED');
  });

  it('cancels a request given up on, with the reason it was given up', async () => {
    const { fetch, made } = fake();
    const controller = new AbortController();
    const answered = fetch('https://api.github.com/user', { signal: controller.signal });
    const request = await made();
    controller.abort(new DOMException('took too long', 'TimeoutError'));
    await expect(answered).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(request.aborted).toBe(true);
    // An answer after that changes nothing.
    request.answer(200, {}, '{}');
  });

  it('reads an answer up to its limit, and cancels one that says it is longer or turns out so', async () => {
    const { fetch, made } = fake(4);
    const within = fetch('https://avatars.githubusercontent.com/octocat?s=40');
    (await made()).answer(200, {}, 'four');
    expect(await (await within).text()).toBe('four');

    const said = fetch('https://avatars.githubusercontent.com/octocat?s=40');
    const saying = await made();
    saying.emit('response', new FakeAnswer(200, { 'content-length': '5' }));
    await expect(said).rejects.toBeInstanceOf(AnswerTooLarge);
    expect(saying.aborted).toBe(true);

    const turned = fetch('https://avatars.githubusercontent.com/octocat?s=40');
    const turning = await made();
    turning.answer(200, {}, 'fives');
    await expect(turned).rejects.toBeInstanceOf(AnswerTooLarge);
    expect(turning.aborted).toBe(true);
  });

  it('sends nothing when given up on before it starts', async () => {
    const { fetch, sent } = fake();
    const answered = fetch('https://api.github.com/user', { signal: AbortSignal.abort() });
    await expect(answered).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent).toEqual([]);
  });

  it('reports how much of the body has gone while it changes, and asks only when told to', async () => {
    vi.useFakeTimers();
    try {
      const { fetch, sent } = fake();
      const heard: [number, number][] = [];
      const init: FetchInit = {
        method: 'POST',
        body: 'x'.repeat(1000),
        uploadProgress: (current, total) => heard.push([current, total]),
      };
      const answered = fetch('https://uploads.github.com/user-attachments/assets', init);
      await vi.advanceTimersByTimeAsync(0);
      const [request] = sent;
      if (!request) throw new Error('nothing was sent');
      // Nothing has gone yet.
      await vi.advanceTimersByTimeAsync(UPLOAD_PROGRESS_EVERY);
      expect(heard).toEqual([]);
      request.progress = { started: true, current: 400, total: 1000 };
      await vi.advanceTimersByTimeAsync(UPLOAD_PROGRESS_EVERY * 3);
      expect(heard).toEqual([[400, 1000]]);
      // The rest went just before GitHub answered: heard at once, then never again.
      request.progress = { started: true, current: 1000, total: 1000 };
      request.answer(201, {}, '{}');
      expect((await answered).status).toBe(201);
      expect(heard).toEqual([
        [400, 1000],
        [1000, 1000],
      ]);
      const asked = request.progressAsked;
      await vi.advanceTimersByTimeAsync(UPLOAD_PROGRESS_EVERY * 4);
      expect(request.progressAsked).toBe(asked);

      const plain = fetch('https://api.github.com/user');
      await vi.advanceTimersByTimeAsync(UPLOAD_PROGRESS_EVERY * 4);
      sent[1]?.answer(200, {}, '{}');
      await plain;
      expect(sent[1]?.progressAsked).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
