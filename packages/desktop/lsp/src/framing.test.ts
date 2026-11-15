import { PassThrough } from 'node:stream';

import { StreamMessageReader } from 'vscode-jsonrpc/node';
import { expect, test } from 'vitest';

import { FrameMeter, HEADER_LIMIT } from './framing.ts';

function message(body: string, header = `Content-Length: ${Buffer.byteLength(body)}`): string {
  return `${header}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n${body}`;
}

/** What the meter says of a message with `header`. */
function refused(header: string): string | undefined {
  return new FrameMeter().feed(Buffer.from(`${header}\r\n\r\n`, 'latin1'));
}

test('messages within the limits pass, however the stream splits them', () => {
  const stream = Buffer.from(message('{"a":"é"}') + message('') + message('{"b":2}'.repeat(50)));
  for (const size of [1, 3, 7, stream.length]) {
    const meter = new FrameMeter({ message: 1024 });
    for (let at = 0; at < stream.length; at += size) {
      expect(meter.feed(stream.subarray(at, at + size))).toBeUndefined();
    }
    for (let handed = 0; handed < 3; handed += 1) expect(meter.handedOn()).toBeUndefined();
    expect(meter.unread).toBe(0);
    expect(meter.handedOn()).toBe('It sent a message Lo didn’t see the end of.');
  }
});

test('the meter reads each header as the reader does', async () => {
  // A length read by parseInt, and a header's name spelled with high bits the reader drops.
  const quirky = [
    message('{"jsonrpc":"2.0","method":"a"}', 'Content-Length: 30 bytes'),
    message('{"jsonrpc":"2.0","method":"b"}', 'Ãontent-Ìength:\t30'),
    message('{"jsonrpc":"2.0","method":"c"}', 'X-Other: 1\r\ncontent-length:30'),
  ].join('');
  const bytes = Buffer.from(quirky, 'latin1');
  const input = new PassThrough();
  const read: string[] = [];
  const reader = new StreamMessageReader(input);
  reader.listen((received) => read.push(JSON.stringify(received)));
  const meter = new FrameMeter();
  expect(meter.feed(bytes)).toBeUndefined();
  input.end(bytes);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(read).toHaveLength(3);
  for (const _ of read) expect(meter.handedOn()).toBeUndefined();
  expect(meter.unread).toBe(0);
});

test('a second length, a header it can’t read, or one too long is refused', () => {
  expect(refused('Content-Length: 10\r\nContent-Length: 400000000')).toBe(
    'It sent a message with two lengths.',
  );
  // The same name once the reader drops its high bits and lowers its case.
  expect(refused('Content-Length: 10\r\nãONTENT-LENGTH: 400000000')).toBe(
    'It sent a message with two lengths.',
  );
  expect(refused('Content-Type: x')).toBe('It sent a message without its length.');
  expect(refused('Content-Length: -5')).toBe('It sent a message with a length Lo can’t read.');
  expect(refused('Content-Length: many')).toBe('It sent a message with a length Lo can’t read.');
  expect(refused('Content-Length 10')).toBe('It sent a header Lo can’t read.');
  expect(refused(`Content-Length: ${'9'.repeat(400)}`)).toMatch(/past the limit/);
  expect(
    new FrameMeter({ message: 1024 }).feed(Buffer.from('Content-Length: 1025\r\n\r\n')),
  ).toMatch(/past the limit of 1 MB/);
  expect(new FrameMeter().feed(Buffer.from('x'.repeat(HEADER_LIMIT + 1)))).toBe(
    'It sent a header too long to read.',
  );
});

test('a flood of small messages is refused past what Lo holds unread', () => {
  const meter = new FrameMeter({ unread: 4096 });
  const frame = Buffer.from(message('{"jsonrpc":"2.0","method":"x"}'));
  let wrong: string | undefined;
  for (let sent = 0; sent < 100 && wrong === undefined; sent += 1) {
    wrong = meter.feed(frame);
    // The reader hands on the first few, then falls behind.
    if (sent < 10) meter.handedOn();
  }
  expect(wrong).toMatch(/before Lo could read it/);
});
