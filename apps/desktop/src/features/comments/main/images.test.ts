import { crc32 } from 'node:zlib';

import { Token } from '@lo/github';
import { describe, expect, it } from 'vitest';

import type { ImageAsked } from '../../../ipc/images.ts';
import {
  ATTACHMENT_STORE,
  IMAGE_LIMITS,
  ImageError,
  Images,
  isAttachment,
  keyOf,
  mayFetch,
  type ImageLimits,
} from './images.ts';

/** Stand-in tokens, shaped like one: octocat's, and hubot's. */
const TOKEN = 'gho_FAKEVIEWTOKENFAKEVIEWTOKENFAKEVIEWTOK';
const OTHER = 'gho_FAKEOTHERTOKENFAKEOTHERTOKENFAKEOTHE';

/** The account each view acts as. Any other view acts as nobody. */
const ACTING: Readonly<Record<string, string>> = {
  'tab-1': 'octocat',
  'tab-2': 'octocat',
  'tab-3': 'hubot',
  'tab-7:12': 'octocat',
};

const ID = '08c730b3-f0b0-4c7d-93a2-95f8d167d0d9';
const ATTACHMENT = `https://github.com/user-attachments/assets/${ID}`;
const ANOTHER = 'https://github.com/user-attachments/assets/1b0e7c2a-5d4f-4e8a-9c3b-6f2d1a0e9b87';
const SIGNED = `https://${ATTACHMENT_STORE}/1/a.png?X-Amz-Signature=abc&X-Amz-Expires=300`;
const CAMO = 'https://camo.githubusercontent.com/abc/68747470733a2f2f652e636f6d2f612e706e67';
const PRIVATE = 'https://private-user-images.githubusercontent.com/1/2-a.png';

/** The start of a PNG `width` by `height` pixels: its signature and its `IHDR` chunk. */
function png(width = 2, height = 2): Uint8Array<ArrayBuffer> {
  const chunk = Buffer.alloc(17);
  chunk.write('IHDR', 0, 'ascii');
  chunk.writeUInt32BE(width, 4);
  chunk.writeUInt32BE(height, 8);
  chunk.set([8, 6, 0, 0, 0], 12);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(chunk));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(Buffer.concat([signature, length, chunk, check]));
}

/** A GIF of one frame, `width` by `height`. */
function gif(width = 3, height = 1): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.alloc(25);
  bytes.write('GIF89a', 0, 'ascii');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  bytes[13] = 0x2c;
  bytes.writeUInt16LE(width, 18);
  bytes.writeUInt16LE(height, 20);
  return new Uint8Array(bytes);
}

const image = (bytes: Uint8Array<ArrayBuffer>, type = 'image/png') =>
  new Response(bytes, { headers: { 'content-type': type } });
const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });

const post = (address: string, view = 'tab-1'): ImageAsked => ({ kind: 'post', view, address });
const avatar = (login: string, size = 56): ImageAsked => ({ kind: 'avatar', login, size });

interface Sent {
  url: string;
  authorization: string | null;
  accept: string | null;
}

/**
 * `Images` over a GitHub that answers each request as `answer` says, with views acting as
 * {@link ACTING} says, whose accounts have `tokens`; what it was sent; and whose tokens it read.
 */
function images(
  answer: (url: string, sent: Sent) => Response | Promise<Response>,
  options: {
    tokens?: Readonly<Record<string, string | undefined>>;
    limits?: Partial<ImageLimits>;
  } = {},
) {
  const tokens = options.tokens ?? { octocat: TOKEN, hubot: OTHER };
  const sent: Sent[] = [];
  const read: string[] = [];
  const loader = new Images({
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const one = {
        url: request.url,
        authorization: request.headers.get('authorization'),
        accept: request.headers.get('accept'),
      };
      sent.push(one);
      return answer(request.url, one);
    },
    acting: (view) => ACTING[view],
    token: (login) => {
      read.push(login);
      const token = tokens[login];
      return Promise.resolve(token === undefined ? undefined : new Token(token));
    },
    limits: options.limits,
  });
  return { loader, sent, read };
}

/** GitHub's answer to an attachment's address: the signed address to an account, 404 to nobody. */
const attachment = (url: string, { authorization }: Sent) => {
  if (url === ATTACHMENT) {
    return authorization === null ? new Response('Not Found', { status: 404 }) : redirect(SIGNED);
  }
  return image(png());
};

const NOT_FOUND = { reason: 'failed', message: 'github.com answered 404' };

/** Why `loading` failed. */
async function refusal(loading: Promise<unknown>): Promise<{ reason: string; message: string }> {
  const error: unknown = await loading.then(
    () => new Error('it loaded'),
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof ImageError)) throw error;
  return { reason: error.reason, message: error.message };
}

describe('Images', () => {
  it("fetches an avatar from GitHub's avatars by login, without the token", async () => {
    const { loader, sent, read } = images(() => image(png(56, 56)));
    const loaded = await loader.load(avatar('rozed-bot'));
    expect(loaded).toMatchObject({ type: 'png', contentType: 'image/png' });
    expect(sent).toEqual([
      {
        url: 'https://avatars.githubusercontent.com/rozed-bot?s=56',
        authorization: null,
        accept: 'image/png, image/jpeg, image/gif, image/webp',
      },
    ]);
    expect(read).toEqual([]);
  });

  it("sends the view's account's token to an attachment's address alone, and follows it to the store without", async () => {
    const { loader, sent, read } = images(attachment);
    const loaded = await loader.load(post(ATTACHMENT, 'tab-7:12'));
    expect(loaded.bytes).toEqual(png());
    expect(sent.map(({ url, authorization }) => [url, authorization])).toEqual([
      [ATTACHMENT, `token ${TOKEN}`],
      [SIGNED, null],
    ]);
    expect(read).toEqual(['octocat']);
  });

  it('asks for an attachment without a token in a view acting as nobody', async () => {
    const { loader, sent, read } = images(attachment);
    expect(await refusal(loader.load(post(ATTACHMENT, 'tab-9')))).toEqual(NOT_FOUND);
    expect(sent.map(({ authorization }) => authorization)).toEqual([null]);
    expect(read).toEqual([]);
  });

  it("asks without a token for an account whose token isn't there", async () => {
    const { loader, sent } = images(attachment, { tokens: {} });
    expect(await refusal(loader.load(post(ATTACHMENT)))).toEqual(NOT_FOUND);
    expect(sent.map(({ authorization }) => authorization)).toEqual([null]);
  });

  it('fetches proxied and signed images without the token', async () => {
    const { loader, sent, read } = images(() => image(png()));
    for (const address of [
      CAMO,
      `${PRIVATE}?jwt=eyJx`,
      'https://user-images.githubusercontent.com/1/a.png',
    ]) {
      await loader.load(post(address));
    }
    expect(sent.map(({ authorization }) => authorization)).toEqual([null, null, null]);
    expect(read).toEqual([]);
  });

  it('gives the token to the address asked for alone, never to an attachment a redirect leads to', async () => {
    // The store, or the proxy, sending Lo back to github.com for another attachment.
    const viaStore = images((url) => {
      if (url === ATTACHMENT) return redirect(SIGNED);
      if (url === SIGNED) return redirect(ANOTHER);
      if (url === ANOTHER) return redirect(`${SIGNED}&second`);
      return image(png());
    });
    await viaStore.loader.load(post(ATTACHMENT));
    expect(viaStore.sent.map(({ url, authorization }) => [url, authorization])).toEqual([
      [ATTACHMENT, `token ${TOKEN}`],
      [SIGNED, null],
      [ANOTHER, null],
      [`${SIGNED}&second`, null],
    ]);
    const viaCamo = images((url) => {
      if (url === CAMO) return redirect(ATTACHMENT);
      if (url === ATTACHMENT) return redirect(SIGNED);
      return image(png());
    });
    await viaCamo.loader.load(post(CAMO));
    expect(viaCamo.sent.map(({ authorization }) => authorization)).toEqual([null, null, null]);
    expect(viaCamo.read).toEqual([]);
  });

  it.each([
    ['an id that steps out of its path', '..%2F..%2Fsettings%2Ftokens'],
    ['a path that steps out', '../../settings/tokens'],
    ["an id that isn't a UUID", 'a'],
    ['a UUID in capitals', ID.toUpperCase()],
    ['a UUID and more', `${ID}/..%2F..`],
  ])("refuses an attachment's address with %s, and sends nothing", async (_what, id) => {
    const { loader, sent, read } = images(attachment);
    const address = new URL(`https://github.com/user-attachments/assets/${id}`).href;
    expect(await refusal(loader.load(post(address)))).toMatchObject({ reason: 'refused' });
    expect(sent).toEqual([]);
    expect(read).toEqual([]);
  });

  it.each([
    ['another host', 'https://example.com/a.png'],
    ['http', 'http://camo.githubusercontent.com/a'],
    ['another port', 'https://camo.githubusercontent.com:8443/a'],
    ['a user name', 'https://me@camo.githubusercontent.com/a'],
    ['a password', 'https://me:secret@camo.githubusercontent.com/a'],
    ['a lookalike host', 'https://camo.githubusercontent.com.example.com/a'],
    ['github.com outside attachments', 'https://github.com/rozed-dev/e2e/raw/main/a.png'],
    ['the attachment store, but from camo', SIGNED],
  ])('refuses a redirect to %s, and never asks it', async (_what, location) => {
    const { loader, sent } = images((url) => (url === CAMO ? redirect(location) : image(png())));
    expect(await refusal(loader.load(post(CAMO)))).toMatchObject({ reason: 'refused' });
    expect(sent.map(({ url }) => url)).toEqual([CAMO]);
  });

  it("refuses an avatar from anywhere but the avatars' host", async () => {
    const { loader, sent } = images(() => redirect(CAMO));
    expect(await refusal(loader.load(avatar('octocat')))).toMatchObject({ reason: 'refused' });
    expect(sent).toHaveLength(1);
  });

  it('reaches the attachment store only as an attachment redirects there', () => {
    const store = new URL(SIGNED);
    expect(mayFetch(post(ATTACHMENT), store, new URL(ATTACHMENT))).toBe(true);
    expect(mayFetch(post(ATTACHMENT), store)).toBe(false);
    expect(mayFetch(post(CAMO), store, new URL(CAMO))).toBe(false);
    expect(mayFetch(post(ATTACHMENT), store, store)).toBe(false);
    expect(mayFetch(avatar('octocat'), store, new URL(ATTACHMENT))).toBe(false);
  });

  it("gives the token only to an attachment's address on github.com", () => {
    expect(isAttachment(new URL(ATTACHMENT))).toBe(true);
    for (const address of [
      `http://github.com/user-attachments/assets/${ID}`,
      `https://github.com:444/user-attachments/assets/${ID}`,
      `https://me@github.com/user-attachments/assets/${ID}`,
      'https://github.com/user-attachments/assets/',
      'https://github.com/user-attachments/assets/a',
      `https://github.com/user-attachments/assets/${ID}/b`,
      `https://github.com/user-attachments/assets/${ID}%2F..%2F..%2Fsettings`,
      `https://github.com/user-attachments/files/${ID}`,
      `https://api.github.com/user-attachments/assets/${ID}`,
      SIGNED,
      CAMO,
    ]) {
      expect(isAttachment(new URL(address))).toBe(false);
    }
  });

  it('follows 5 redirects, and refuses a sixth', async () => {
    const hops = (count: number) => {
      const chain = Array.from({ length: count + 1 }, (_, at) => `${CAMO}/${at}`);
      return images((url) => {
        const at = chain.indexOf(url);
        return at < count ? redirect(chain[at + 1] ?? '') : image(png());
      });
    };
    const five = hops(5);
    await five.loader.load(post(`${CAMO}/0`));
    expect(five.sent).toHaveLength(6);
    const six = hops(6);
    expect(await refusal(six.loader.load(post(`${CAMO}/0`)))).toEqual({
      reason: 'refused',
      message: 'camo.githubusercontent.com redirected more than 5 times',
    });
    expect(six.sent).toHaveLength(6);
  });

  it('serves a PNG, JPEG, GIF or WebP by its bytes alone, whatever the host said it was', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03]);
    const webp = new Uint8Array(
      Buffer.from('RIFF\x16\0\0\0WEBPVP8X\x0a\0\0\0\0\0\0\0\x01\0\0\x02\0\0', 'latin1'),
    );
    const served = new Map<string, Uint8Array<ArrayBuffer>>([
      [`${CAMO}/png`, png()],
      [`${CAMO}/jpeg`, jpeg],
      [`${CAMO}/gif`, gif()],
      [`${CAMO}/webp`, webp],
    ]);
    const { loader } = images((url) => image(served.get(url) ?? png(), 'text/html'));
    const types = [];
    for (const kind of served.keys()) types.push((await loader.load(post(kind))).contentType);
    expect(types).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  });

  it.each([
    ['an SVG', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['a page', '<!doctype html><title>Sign in</title>'],
    ['a video', '\0\0\0\x18ftypmp42'],
    ['nothing', ''],
  ])('refuses %s, even served as an image', async (_what, body) => {
    const { loader } = images(() => image(new Uint8Array(Buffer.from(body, 'latin1'))));
    expect(await refusal(loader.load(post(CAMO)))).toEqual({
      reason: 'unsafe',
      message:
        'camo.githubusercontent.com served something other than a PNG, JPEG, GIF or WebP image',
    });
  });

  it('refuses an image whose header is damaged', async () => {
    const damaged = png();
    damaged[29] = (damaged[29] ?? 0) ^ 0xff;
    const { loader } = images(() => image(damaged));
    expect(await refusal(loader.load(post(CAMO)))).toMatchObject({ reason: 'unsafe' });
  });

  it('refuses an image past 16,384 pixels a side or 40 megapixels', async () => {
    expect([IMAGE_LIMITS.side, IMAGE_LIMITS.pixels]).toEqual([16_384, 40_000_000]);
    const sizes = new Map([
      [`${CAMO}/wide`, png(16_385, 1)],
      [`${CAMO}/tall`, gif(1, 16_385)],
      [`${CAMO}/many`, png(8_000, 5_001)],
      [`${CAMO}/most`, png(8_000, 5_000)],
    ]);
    const { loader } = images((url) => image(sizes.get(url) ?? png()));
    const outcomes = [];
    for (const address of sizes.keys()) {
      outcomes.push(
        await loader.load(post(address)).then(
          () => 'served',
          (error: unknown) => (error instanceof ImageError ? error.reason : 'thrown'),
        ),
      );
    }
    expect(outcomes).toEqual(['unsafe', 'unsafe', 'unsafe', 'served']);
  });

  it('refuses an image past 16 MiB, by the length it says or the bytes it sends', async () => {
    expect(IMAGE_LIMITS.bytes).toBe(16 * 1024 * 1024);
    const limits = { bytes: 64 };
    const said = images(
      () =>
        new Response(png(), { headers: { 'content-length': '65', 'content-type': 'image/png' } }),
      { limits },
    );
    expect(await refusal(said.loader.load(post(CAMO)))).toEqual({
      reason: 'unsafe',
      message: 'camo.githubusercontent.com served more than 64 bytes',
    });
    const long = new Uint8Array(65);
    long.set(png());
    const sent = images(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(long.slice(0, 40));
              controller.enqueue(long.slice(40));
              controller.close();
            },
          }),
        ),
      { limits },
    );
    expect(await refusal(sent.loader.load(post(CAMO)))).toMatchObject({ reason: 'unsafe' });
    const within = images(() => image(png()), { limits });
    await within.loader.load(post(CAMO));
  });

  it('gives up on an image that takes longer than its deadline', async () => {
    expect(IMAGE_LIMITS.deadline).toBe(30_000);
    const loader = new Images({
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => reject(new Error(String(signal.reason))));
        }),
      acting: () => undefined,
      token: () => Promise.resolve(undefined),
      limits: { deadline: 10 },
    });
    expect(await refusal(loader.load(post(CAMO)))).toEqual({
      reason: 'failed',
      message: 'it took longer than 0.01 s',
    });
  });

  it('never says the token, whatever went wrong', async () => {
    const { loader } = images(() => {
      throw new Error(`refused authorization: token ${TOKEN}`);
    });
    const { message } = await refusal(loader.load(post(ATTACHMENT)));
    expect(message).toBe("Lo couldn't reach github.com");
    expect(message).not.toContain(TOKEN);
  });

  it('keeps an image for the account it was fetched as alone, never for another or nobody', async () => {
    const { loader, sent } = images(attachment);
    const first = await loader.load(post(ATTACHMENT, 'tab-1'));
    // Another view acting as the same account finds it.
    expect(await loader.load(post(ATTACHMENT, 'tab-2'))).toBe(first);
    expect(sent).toHaveLength(2);
    // A view acting as nobody asks GitHub, without a token, and GitHub refuses.
    expect(await refusal(loader.load(post(ATTACHMENT, 'tab-9')))).toEqual(NOT_FOUND);
    // A view acting as another account asks GitHub with that account's token.
    await loader.load(post(ATTACHMENT, 'tab-3'));
    expect(sent.slice(2).map(({ url, authorization }) => [url, authorization])).toEqual([
      [ATTACHMENT, null],
      [ATTACHMENT, `token ${OTHER}`],
      [SIGNED, null],
    ]);
  });

  it('fetches apart for an account and nobody asking at once', async () => {
    const answers: (() => void)[] = [];
    const { loader, sent } = images(
      (url, one) =>
        new Promise<Response>((resolve) => answers.push(() => resolve(attachment(url, one)))),
    );
    const both = Promise.allSettled([
      loader.load(post(ATTACHMENT, 'tab-1')),
      loader.load(post(ATTACHMENT, 'tab-9')),
    ]);
    await expect.poll(() => sent.length).toBe(2);
    while (answers.length > 0) {
      answers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve));
    }
    expect((await both).map(({ status }) => status)).toEqual(['fulfilled', 'rejected']);
    const asked = sent.map(({ url, authorization }) => `${url} ${authorization ?? 'nobody'}`);
    expect(asked.toSorted()).toEqual(
      [`${ATTACHMENT} nobody`, `${ATTACHMENT} token ${TOKEN}`, `${SIGNED} nobody`].toSorted(),
    );
  });

  it('keeps a signed image by its whole address, so no other signature, or none, finds it', async () => {
    const signed = `${PRIVATE}?jwt=eyJ.real`;
    const { loader, sent } = images((url) =>
      url === signed ? image(png()) : new Response('Not Found', { status: 404 }),
    );
    const first = await loader.load(post(signed));
    for (const address of [`${PRIVATE}?jwt=eyJ.fake`, PRIVATE, `${PRIVATE}?jwt=`]) {
      expect(await refusal(loader.load(post(address)))).toMatchObject({ reason: 'failed' });
    }
    expect(await loader.load(post(`${signed}#again`))).toBe(first);
    expect(sent.map(({ url }) => url)).toEqual([
      signed,
      `${PRIVATE}?jwt=eyJ.fake`,
      PRIVATE,
      `${PRIVATE}?jwt=`,
    ]);
    expect(keyOf(post(signed), 'octocat')).toBe(`post @octocat ${signed}`);
    expect(keyOf(post(signed), 'Octocat')).toBe(keyOf(post(signed), 'octocat'));
    expect(keyOf(post(signed))).toBe(`post nobody ${signed}`);
    expect(keyOf(avatar('Rozed-Bot'))).toBe(keyOf(avatar('rozed-bot')));
    expect(keyOf(avatar('rozed-bot', 40))).not.toBe(keyOf(avatar('rozed-bot', 56)));
  });

  it('keeps at most its limit of bytes, dropping the image served longest ago', async () => {
    const size = png().length;
    const { loader, sent } = images(() => image(png()), { limits: { kept: size * 2 } });
    for (const at of [1, 2, 1, 3, 1, 2]) await loader.load(post(`${CAMO}/${at}`));
    // 1 and 2 are kept; 3 drops 2, which was served longest ago; 2 is fetched again.
    expect(sent.map(({ url }) => url.at(-1))).toEqual(['1', '2', '3', '2']);
    expect(IMAGE_LIMITS.kept).toBe(64 * 1024 * 1024);
  });

  it('fetches 6 images at once at most, and the rest in turn', async () => {
    expect(IMAGE_LIMITS.fetching).toBe(6);
    const answers: (() => void)[] = [];
    const { loader, sent } = images(
      () => new Promise<Response>((resolve) => answers.push(() => resolve(image(png())))),
    );
    const all = Promise.all(
      Array.from({ length: 8 }, (_, at) => loader.load(post(`${CAMO}/${at}`))),
    );
    await expect.poll(() => sent.length).toBe(6);
    answers.shift()?.();
    await expect.poll(() => sent.length).toBe(7);
    while (sent.length < 8 || answers.length > 0) {
      answers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve));
    }
    expect(await all).toHaveLength(8);
  });

  it('fetches once for two asks at once, and keeps nothing that failed', async () => {
    let failing = true;
    const { loader, sent } = images(() =>
      failing ? new Response(null, { status: 502 }) : image(png()),
    );
    const both = await Promise.allSettled([loader.load(post(CAMO)), loader.load(post(CAMO))]);
    expect(both.map(({ status }) => status)).toEqual(['rejected', 'rejected']);
    expect(sent).toHaveLength(1);
    failing = false;
    await loader.load(post(CAMO));
    expect(sent).toHaveLength(2);
  });
});
