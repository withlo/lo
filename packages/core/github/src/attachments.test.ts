import { expect, test } from 'vitest';

import {
  altText,
  attachmentKind,
  attachmentMarkdown,
  bytesAgree,
  describeRefusal,
  formatSize,
  FREE_VIDEO_LIMIT,
  IMAGE_LIMIT,
  isAssetUrl,
  needsPaidPlan,
  prepareAttachment,
  RefusedAttachment,
  uploadAttachment,
  VIDEO_LIMIT,
  type AttachmentRefusal,
  uploadTimeoutMs,
} from './attachments.ts';
import { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { Token } from './token.ts';

/** `text`'s characters as bytes, one each. */
function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}

function be32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

/** A box of `type`, holding `content`. */
function box(type: string, content: Uint8Array): Uint8Array {
  return concat(be32(content.length + 8), latin1(type), content);
}

/** A 3×2 green PNG, as an encoder writes it: its signature, IHDR, one IDAT and IEND. */
const PNG = new Uint8Array(
  Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000030000000208060000009d74661a0000002549444154780101' +
      '1a00e5ff000ac81eff0ac81eff0ac81eff000ac81eff0ac81eff0ac81eff904d0b9b22652228000000004945' +
      '4e44ae426082',
    'hex',
  ),
);

/** A MOV with nothing in it to take out: its type, and a movie header. */
function mov(): Uint8Array {
  return concat(
    box('ftyp', latin1('qt  \0\0\0\0qt  ')),
    box('moov', box('mvhd', new Uint8Array(100))),
  );
}

/** Why preparing an attachment was refused, or nothing when it wasn't. */
function refusal(prepare: () => unknown): AttachmentRefusal | undefined {
  try {
    prepare();
    return undefined;
  } catch (error) {
    if (error instanceof RefusedAttachment) return error.refusal;
    throw error;
  }
}

test('kinds come from the extension', () => {
  expect(attachmentKind('a.PNG')).toBe('png');
  expect(attachmentKind('photo.jpeg')).toBe('jpeg');
  expect(attachmentKind('clip.MOV')).toBe('mov');
  expect(attachmentKind('notes.txt')).toBeUndefined();
  expect(attachmentKind('png')).toBeUndefined();
});

test('a file must be what its name says', () => {
  expect(prepareAttachment('a.png', PNG).kind).toBe('png');
  expect(refusal(() => prepareAttachment('a.jpg', PNG))).toEqual({
    reason: 'mislabelled',
    kind: 'jpeg',
  });
  expect(refusal(() => prepareAttachment('a.txt', PNG))).toEqual({ reason: 'unsupported' });
  expect(refusal(() => prepareAttachment('a.png', new Uint8Array()))).toEqual({ reason: 'empty' });
});

test('images over 10 mib and videos over 100 are refused', () => {
  const big = new Uint8Array(IMAGE_LIMIT + 1);
  big.set(PNG);
  // Its trailing bytes go as metadata: what's sent is what counts.
  expect(prepareAttachment('big.png', big).bytes.length).toBeLessThan(1024);
  const bigger = new Uint8Array(2 * IMAGE_LIMIT + 1);
  bigger.set(PNG);
  expect(refusal(() => prepareAttachment('big.png', bigger))).toEqual({
    reason: 'tooLarge',
    limit: IMAGE_LIMIT,
  });
  const video = new Uint8Array(VIDEO_LIMIT + 1);
  video.set(mov());
  expect(refusal(() => prepareAttachment('clip.mov', video))).toEqual({
    reason: 'tooLarge',
    limit: VIDEO_LIMIT,
  });
  expect(describeRefusal({ reason: 'tooLarge', limit: IMAGE_LIMIT })).toBe(
    "it's larger than GitHub's 10 MB",
  );
});

test('a video over 10 mib needs a paid plan', () => {
  const video = mov();
  expect(needsPaidPlan(prepareAttachment('clip.mov', video))).toBe(false);
  // A free box at the end, as padding.
  const padded = concat(video, box('free', new Uint8Array(FREE_VIDEO_LIMIT)));
  expect(needsPaidPlan(prepareAttachment('clip.mov', padded))).toBe(true);
});

test('alt text is the name as githubs uploader writes it', () => {
  expect(altText('login.screen.png')).toBe('login screen');
  expect(altText('a [b] \\c.gif')).toBe('a \\[b\\] \\\\c');
  expect(altText('.png')).toBe('image');
  expect(
    attachmentMarkdown('png', 'shot.png', 'https://github.com/user-attachments/assets/a-1'),
  ).toBe('![shot](https://github.com/user-attachments/assets/a-1)');
  expect(
    attachmentMarkdown('mp4', 'clip.mp4', 'https://github.com/user-attachments/assets/a-1'),
  ).toBe('https://github.com/user-attachments/assets/a-1');
});

test('only an attachments address goes into a comment', () => {
  expect(
    isAssetUrl('https://github.com/user-attachments/assets/8f8214ac-43e5-414e-8f71-44210f90a2ee'),
  ).toBe(true);
  const others = [
    'https://github.com/user-attachments/assets/',
    'http://github.com/user-attachments/assets/a',
    'https://example.com/user-attachments/assets/a',
    'https://github.com/user-attachments/assets/a)![x](https://example.com/x',
    'https://github.com/user-attachments/assets/a?x=1',
    'https://github.com/user-attachments/assets/../files/a',
  ];
  expect(others.filter(isAssetUrl)).toEqual([]);
});

/**
 * Uploads a PNG as `gho_OLD`, answered with each of `statuses` in turn; when `renews`, a refused
 * token is renewed as `gho_NEW`. Returns the attachment's address or the error, and the token each
 * request came with.
 */
async function uploading(
  statuses: number[],
  renews: boolean,
): Promise<{ url?: string; error?: GithubError; tokens: string[] }> {
  const tokens: string[] = [];
  const redirects: Request['redirect'][] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    tokens.push(request.headers.get('authorization') ?? '');
    redirects.push(request.redirect);
    await request.arrayBuffer();
    const status = statuses.shift();
    if (status === undefined) throw new Error('there was no answer left for this request');
    const body =
      status === 200 || status === 201
        ? '{"url":"https://github.com/user-attachments/assets/a-1"}'
        : '{"message":"Bad credentials"}';
    return new Response(body, { status });
  };
  const client = new GithubClient({
    fetch,
    token: new Token('gho_OLD'),
    onUnauthorized: () => Promise.resolve(renews ? new Token('gho_NEW') : undefined),
  });
  const file = prepareAttachment('a.png', PNG);
  let outcome: { url?: string; error?: GithubError };
  try {
    outcome = { url: await uploadAttachment(client, 1, file) };
  } catch (error) {
    if (!(error instanceof GithubError)) throw error;
    outcome = { error };
  }
  // `fetch` never follows a redirect for an upload: the client decides where its token goes.
  expect(redirects.filter((redirect) => redirect !== 'manual')).toEqual([]);
  return { ...outcome, tokens };
}

test('a refused token renewed sends the upload once more', async () => {
  const renewed = await uploading([401, 201], true);
  expect(renewed.url).toBe('https://github.com/user-attachments/assets/a-1');
  expect(renewed.tokens).toEqual(['token gho_OLD', 'token gho_NEW']);
  // Without a new token, it's refused, sent once.
  const refused = await uploading([401], false);
  expect(refused.error?.isUnauthorized()).toBe(true);
  expect(refused.tokens).toEqual(['token gho_OLD']);
  // Any other refusal is never sent again.
  const missing = await uploading([404], true);
  expect(missing.error).toBeInstanceOf(GithubError);
  expect(missing.tokens).toEqual(['token gho_OLD']);
});

test('a success other than 201 says what github answered', async () => {
  const { error } = await uploading([200], false);
  expect(error?.message).toContain('GitHub answered 200');
});

test('a heic photo named mp4 isnt a video', () => {
  const heic = concat(new Uint8Array([0, 0, 0, 24]), latin1('ftypheic\0\0\0\0mif1heic'));
  expect(bytesAgree('mp4', heic)).toBe(false);
  expect(bytesAgree('mov', heic)).toBe(false);
  const mp4 = concat(new Uint8Array([0, 0, 0, 24]), latin1('ftypisom\0\0\0\0isommp41'));
  expect(bytesAgree('mp4', mp4)).toBe(true);
});

test('sizes read as people read them', () => {
  expect(formatSize(512)).toBe('512 bytes');
  expect(formatSize(250_000)).toBe('244 KB');
  expect(formatSize(2_200_000)).toBe('2.1 MB');
  expect(formatSize(IMAGE_LIMIT)).toBe('10 MB');
  expect(formatSize(VIDEO_LIMIT)).toBe('100 MB');
});

test('a large upload has longer to finish', () => {
  expect(uploadTimeoutMs(0)).toBe(30_000);
  expect(uploadTimeoutMs(100 * 1024 * 1024)).toBe((30 + 400) * 1000);
});
