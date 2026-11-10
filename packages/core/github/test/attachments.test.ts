/**
 * Attachments, replayed from what `rozed-bot` uploaded to `rozed-dev/e2e`, which is public, and to
 * `rozed-dev/playground`, which is private, as Lo uploads them. The replaying `fetch` answers a
 * request only when it's the one recorded, bytes and all, so each test also checks what Lo sends.
 * Every file is a few hundred bytes. An upload can't be deleted, and isn't in any comment.
 */

import { replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import {
  attachmentTarget,
  explainUploadError,
  isAssetUrl,
  prepareAttachment,
  UPLOAD_PATH,
  uploadAttachment,
  type AttachmentTarget,
  type PreparedAttachment,
} from '../src/attachments.ts';
import { GITHUB_URLS, GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import { RepoRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';

const UPLOAD_URL = `${GITHUB_URLS.uploads}${UPLOAD_PATH}`;

const E2E = new RepoRef('rozed-dev', 'e2e');
const PLAYGROUND = new RepoRef('rozed-dev', 'playground');

function replaying(cassette: string) {
  const fetch = replayFetch(cassette);
  return { client: new GithubClient({ fetch, token: new Token('gho_FAKE') }), fetch };
}

function hex(lines: readonly string[]): Uint8Array {
  return new Uint8Array(Buffer.from(lines.join(''), 'hex'));
}

/** `text`'s characters as bytes, one each. */
function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}

function be16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

function be32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function contains(bytes: Uint8Array, needle: Uint8Array): boolean {
  return Buffer.from(bytes).indexOf(needle) !== -1;
}

/** A 2×2 red PNG, the bytes that were recorded. */
const PNG = hex([
  '89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000001949444154780101',
  '0e00f1ff00c81e1ec81e1e00c81e1ec81e1e1f260411ecbcd8e10000000049454e44ae426082',
]);

/** A 2×2 blue JPEG, as the encoder wrote it before the photo's EXIF went in. */
const ENCODED_JPEG = hex([
  'ffd8ffe000104a46494600010200000100010000ffc00011080002000203011100021101031101ffdb004300',
  '080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c',
  '2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232',
  '3232323232323232323232323232323232323232323232323232323232323232323232323232323232323232',
  '32ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303',
  '020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f024',
  '33627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a63646566',
  '6768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7',
  'b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc400',
  '1f0100030101010101010101010000000000000102030405060708090a0bffc400b511000201020404030407',
  '05040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a',
  '162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a63646566676869',
  '6a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9',
  'bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c030100',
  '02110311003f00f30afd30e33fffd9',
]);

/** A 2×2 JPEG whose EXIF names a phone and a latitude, as a phone's photo does. */
function photo(): Uint8Array {
  const app0End = 4 + new DataView(ENCODED_JPEG.buffer).getUint16(4);
  const tiff = concat(
    latin1('MM\0*'),
    be32(8),
    be16(2),
    // Make: "Lo", inline.
    new Uint8Array([0x01, 0x0f, 0, 2, 0, 0, 0, 3]),
    latin1('Lo\0\0'),
    // The GPS IFD, after this one.
    new Uint8Array([0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 38]),
    be32(0),
    // GPSLatitudeRef "N".
    be16(1),
    new Uint8Array([0, 1, 0, 2, 0, 0, 0, 2]),
    latin1('N\0\0\0'),
    be32(0),
  );
  const payload = concat(latin1('Exif\0\0'), tiff);
  return concat(
    ENCODED_JPEG.subarray(0, app0End),
    new Uint8Array([0xff, 0xe1]),
    be16(payload.length + 2),
    payload,
    ENCODED_JPEG.subarray(app0End),
  );
}

/** Whether `jpeg` still has its GPS IFD. */
function hasGps(jpeg: Uint8Array | undefined): boolean {
  return (
    jpeg !== undefined &&
    contains(jpeg, new Uint8Array([0x88, 0x25])) &&
    contains(jpeg, latin1('Exif\0\0'))
  );
}

/** The error an upload failed with. */
async function refusal(upload: Promise<string>): Promise<GithubError> {
  try {
    await upload;
  } catch (error) {
    if (error instanceof GithubError) return error;
    throw error;
  }
  throw new Error('the upload went through');
}

/** What GitHub answered. */
interface Uploads {
  target: AttachmentTarget;
  /** A PNG, as Lo sends it. */
  png: string;
  /** The photo with its location taken out, as Lo sends it. */
  photo: string;
  /** The photo as it was, which Lo never sends: to read back whether GitHub keeps its location. */
  rawPhoto: string;
  /** Why the PNG to a repository that doesn't exist was refused. */
  nowhere: GithubError;
}

/** Uploads to e2e, as the comment box does. */
async function e2eUploads(client: GithubClient): Promise<Uploads> {
  const target = await attachmentTarget(client, E2E);
  const id = target.repositoryId;
  const png = prepareAttachment('lo-attachment.png', PNG);
  const stripped = prepareAttachment('lo-photo.jpg', photo());
  const raw: PreparedAttachment = {
    name: 'lo-photo-as-it-was.jpg',
    kind: 'jpeg',
    bytes: photo(),
    metadata: { kind: 'asIs' },
  };
  return {
    target,
    png: await uploadAttachment(client, id, png),
    photo: await uploadAttachment(client, id, stripped),
    rawPhoto: await uploadAttachment(client, id, raw),
    nowhere: await refusal(uploadAttachment(client, 0, png)),
  };
}

/** The PNG uploaded to the playground, which is private. */
async function privateUpload(
  client: GithubClient,
): Promise<{ target: AttachmentTarget; url: string }> {
  const target = await attachmentTarget(client, PLAYGROUND);
  const png = prepareAttachment('lo-private.png', PNG);
  return { target, url: await uploadAttachment(client, target.repositoryId, png) };
}

test('uploads go to githubs attachments as gh sends them', async () => {
  const { client, fetch } = replaying('attachments_e2e');
  const uploads = await e2eUploads(client);
  expect(uploads.target.canWrite).toBe(true);
  const urls = [uploads.png, uploads.photo, uploads.rawPhoto];
  expect(urls.filter((url) => !isAssetUrl(url))).toEqual([]);
  const sent = fetch.seen.filter((seen) => seen.url.startsWith(UPLOAD_URL));
  expect(sent).toHaveLength(4);
  const [first, stripped, raw] = sent;
  expect(first?.method).toBe('POST');
  expect(first?.url).toBe(
    `${UPLOAD_URL}?name=lo-attachment.png&content_type=image%2Fpng&repository_id=${uploads.target.repositoryId}`,
  );
  expect(first?.headers.get('authorization')).toBe('token gho_FAKE');
  expect(first?.headers.get('content-type')).toBe('application/octet-stream');
  expect(first?.body).toEqual(PNG);
  // The photo went without its location; the one sent as it was kept it.
  expect(hasGps(stripped?.body)).toBe(false);
  expect(hasGps(raw?.body)).toBe(true);
});

test('an upload to a repository that isnt there is refused', async () => {
  const { client } = replaying('attachments_e2e');
  const { nowhere } = await e2eUploads(client);
  const { detail } = nowhere;
  const refused =
    detail.kind === 'notFound' || (detail.kind === 'api' && [404, 422].includes(detail.status));
  expect(refused).toBe(true);
  expect(explainUploadError(nowhere, 'rozed-dev/e2e')).not.toBe('');
});

test('a private repositorys upload goes to it', async () => {
  const { client, fetch } = replaying('attachments_playground');
  const { target, url } = await privateUpload(client);
  expect(isAssetUrl(url)).toBe(true);
  const upload = fetch.seen.find((seen) => seen.url.startsWith(UPLOAD_URL));
  expect(upload?.url.endsWith(`repository_id=${target.repositoryId}`)).toBe(true);
});
