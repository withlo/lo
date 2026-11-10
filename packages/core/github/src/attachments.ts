/**
 * Attaching images and videos to comments, as `gh --attach` does: one `POST` of the file's bytes to
 * `uploads.github.com/user-attachments/assets` with the account's token, which GitHub answers with
 * the asset's address on `github.com`, for the comment's Markdown to show.
 *
 * - **Which files:** PNG, JPEG, GIF, WebP and SVG images up to 10 MiB, and MP4, MOV and WebM videos
 *   up to 100 MiB, told by the name's extension, as GitHub's uploader tells them, and only when the
 *   bytes agree. An empty file is refused. GitHub takes videos over 10 MiB only on paid plans; Lo
 *   says so, and GitHub's refusal says it again.
 * - **What goes first** (`./metadata.ts`): a photo's metadata, where it was taken among it, and
 *   where a video was filmed. The comment box says what went, and what's sent as it is.
 * - **Who may:** an account with write access to the repository
 *   ({@link AttachmentTarget.canWrite}), as `gh` checks first: GitHub answers anyone else's upload
 *   `404`, the same as an upload with a token it won't take, and Lo can't tell those apart.
 * - **Uploads can't be undone:** GitHub has no way to delete one, so Lo never sends one again by
 *   itself, but for once when GitHub refused the token, and so took nothing, and the account's
 *   `onUnauthorized` renewed it.
 * - **Where a file goes:** only to GitHub's uploads address, with the account's token, and the
 *   address GitHub answers must be an attachment's on `github.com` before Markdown shows it. On a
 *   private repository that address answers only to someone signed in who can see it; Lo never
 *   fetches it, and shows an attachment in the preview from the bytes it sent.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { isRecord } from './graphql.ts';
import { stripMetadata, UnreadableMetadata, type Metadata } from './metadata.ts';
import type { RepoRef } from './refs.ts';

/** Where attachments go, under GitHub's uploads address. */
export const UPLOAD_PATH = '/user-attachments/assets';

/** The address an attachment's answer names: `https://github.com/user-attachments/assets/<id>`. */
const ASSET_PREFIX = 'https://github.com/user-attachments/assets/';

/** The largest image GitHub takes, as `gh` checks it. */
export const IMAGE_LIMIT = 10 * 1024 * 1024;
/** The largest video GitHub takes, on a paid plan. */
export const VIDEO_LIMIT = 100 * 1024 * 1024;
/** The largest video GitHub takes on a free plan. */
export const FREE_VIDEO_LIMIT = 10 * 1024 * 1024;

/** A kind of file GitHub takes as an attachment. */
export type AttachmentKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'mp4' | 'mov' | 'webm';

/** What Lo knows about a kind of attachment. */
export interface AttachmentKindInfo {
  /** What it's called: "PNG". */
  label: string;
  /** The extension a file of it gets when it has no name of its own, as a pasted image. */
  extension: string;
  contentType: string;
  video: boolean;
}

export const ATTACHMENT_KINDS: Readonly<Record<AttachmentKind, AttachmentKindInfo>> = {
  png: { label: 'PNG', extension: 'png', contentType: 'image/png', video: false },
  jpeg: { label: 'JPEG', extension: 'jpg', contentType: 'image/jpeg', video: false },
  gif: { label: 'GIF', extension: 'gif', contentType: 'image/gif', video: false },
  webp: { label: 'WebP', extension: 'webp', contentType: 'image/webp', video: false },
  svg: { label: 'SVG', extension: 'svg', contentType: 'image/svg+xml', video: false },
  mp4: { label: 'MP4', extension: 'mp4', contentType: 'video/mp4', video: true },
  mov: { label: 'MOV', extension: 'mov', contentType: 'video/quicktime', video: true },
  webm: { label: 'WebM', extension: 'webm', contentType: 'video/webm', video: true },
};

const EXTENSIONS = new Map<string, AttachmentKind>([
  ['png', 'png'],
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['gif', 'gif'],
  ['webp', 'webp'],
  ['svg', 'svg'],
  ['mp4', 'mp4'],
  ['mov', 'mov'],
  ['webm', 'webm'],
]);

/** The kind `name`'s extension says, if it's one GitHub takes. */
export function attachmentKind(name: string): AttachmentKind | undefined {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return undefined;
  const extension = name.slice(dot + 1).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return EXTENSIONS.get(extension);
}

/** The largest file of `kind` GitHub takes. */
export function uploadLimit(kind: AttachmentKind): number {
  return ATTACHMENT_KINDS[kind].video ? VIDEO_LIMIT : IMAGE_LIMIT;
}

/**
 * The largest file of `kind` Lo reads: what GitHub takes, and for an image, room for metadata Lo
 * may take out, such as an HDR gain map.
 */
export function readLimit(kind: AttachmentKind): number {
  return ATTACHMENT_KINDS[kind].video ? VIDEO_LIMIT : 2 * IMAGE_LIMIT;
}

/** Whether `bytes` are a file of `kind`, by how they start. */
export function bytesAgree(kind: AttachmentKind, bytes: Uint8Array): boolean {
  switch (kind) {
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'gif':
      return ['GIF87a', 'GIF89a'].includes(text(bytes, 0, 6));
    case 'webp':
      return text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 12) === 'WEBP';
    case 'svg': {
      const start = new TextDecoder()
        .decode(bytes.subarray(0, 4096))
        .replace(/^﻿+/, '')
        .trimStart();
      return start.startsWith('<') && start.includes('<svg');
    }
    case 'mp4':
      return text(bytes, 4, 8) === 'ftyp' && !imageBrand(bytes);
    case 'mov':
      // Older QuickTime files start with any of these.
      return QUICKTIME_STARTS.includes(text(bytes, 4, 8)) && !imageBrand(bytes);
    case 'webm':
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    default:
      return kind satisfies never;
  }
}

const QUICKTIME_STARTS = ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

/** The bytes from `start` to `end` as characters, one each: a file's signature or a box's type. */
function text(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * The `ftyp` brands of still images in an MP4's box structure: HEIF and AVIF, whose EXIF Lo
 * doesn't read.
 */
const IMAGE_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevm',
  'hevs',
  'hevx',
  'mif1',
  'mif2',
  'msf1',
  'avif',
  'avis',
  'avio',
]);

/**
 * Whether `bytes`, a file in an MP4's box structure, names a still image's brand in its `ftyp`,
 * major or compatible: a HEIC photo renamed `.mp4`.
 */
function imageBrand(bytes: Uint8Array): boolean {
  if (text(bytes, 4, 8) !== 'ftyp') return false;
  const size = Math.min(new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0), bytes.length);
  // The major brand, a minor version, then the compatible brands.
  const brands = [text(bytes, 8, 12)];
  for (let at = 16; at + 4 <= bytes.length && at < size; at += 4) {
    brands.push(text(bytes, at, at + 4));
  }
  return brands.some((brand) => IMAGE_BRANDS.has(brand));
}

/** Why Lo won't attach a file, before anything is sent. */
export type AttachmentRefusal =
  /** Not a kind GitHub takes, by its name. */
  | { reason: 'unsupported' }
  | { reason: 'empty' }
  /** Larger than GitHub takes, `limit` bytes. */
  | { reason: 'tooLarge'; limit: number }
  /** Its name says `kind`, but its bytes don't. */
  | { reason: 'mislabelled'; kind: AttachmentKind }
  /** Lo couldn't read through its metadata, so it can't say what it would send. */
  | { reason: 'unreadable'; why: string };

/** What the comment box says when Lo won't attach a file. */
export function describeRefusal(refusal: AttachmentRefusal): string {
  switch (refusal.reason) {
    case 'unsupported':
      return 'GitHub takes PNG, JPEG, GIF, WebP and SVG images and MP4, MOV and WebM videos';
    case 'empty':
      return "it's empty";
    case 'tooLarge':
      return `it's larger than GitHub's ${formatSize(refusal.limit)}`;
    case 'mislabelled':
      return `its name says ${ATTACHMENT_KINDS[refusal.kind].label}, but it isn't`;
    case 'unreadable':
      return `Lo couldn't read through its metadata: ${refusal.why}`;
    default:
      return refusal satisfies never;
  }
}

/** A file Lo won't attach. {@link RefusedAttachment.refusal} says why. */
export class RefusedAttachment extends Error {
  override name = 'RefusedAttachment';
  readonly refusal: AttachmentRefusal;

  constructor(refusal: AttachmentRefusal, options?: ErrorOptions) {
    super(describeRefusal(refusal), options);
    this.refusal = refusal;
  }
}

/** A file ready to attach, as {@link prepareAttachment} makes it: what's sent, and what Lo did to it first. */
export interface PreparedAttachment {
  /** Its name, as GitHub gets it. */
  readonly name: string;
  readonly kind: AttachmentKind;
  /** What's sent. */
  readonly bytes: Uint8Array;
  /** What Lo took out of it. */
  readonly metadata: Metadata;
}

/**
 * `bytes`, the file called `name`, checked, with its metadata taken out (`./metadata.ts`). Throws
 * {@link RefusedAttachment} when Lo won't attach it.
 */
export function prepareAttachment(name: string, bytes: Uint8Array): PreparedAttachment {
  const kind = attachmentKind(name);
  if (kind === undefined) throw new RefusedAttachment({ reason: 'unsupported' });
  if (bytes.length === 0) throw new RefusedAttachment({ reason: 'empty' });
  const limit = uploadLimit(kind);
  if (bytes.length > readLimit(kind)) throw new RefusedAttachment({ reason: 'tooLarge', limit });
  if (!bytesAgree(kind, bytes)) throw new RefusedAttachment({ reason: 'mislabelled', kind });
  let stripped: { bytes: Uint8Array; metadata: Metadata };
  try {
    stripped = stripMetadata(kind, bytes);
  } catch (error) {
    if (!(error instanceof UnreadableMetadata)) throw error;
    throw new RefusedAttachment({ reason: 'unreadable', why: error.message }, { cause: error });
  }
  if (stripped.bytes.length > limit) throw new RefusedAttachment({ reason: 'tooLarge', limit });
  return { name, kind, bytes: stripped.bytes, metadata: stripped.metadata };
}

/** Whether GitHub takes `file` only on a paid plan: a video over {@link FREE_VIDEO_LIMIT}. */
export function needsPaidPlan(file: PreparedAttachment): boolean {
  return ATTACHMENT_KINDS[file.kind].video && file.bytes.length > FREE_VIDEO_LIMIT;
}

/** `bytes` as people read sizes: "245 KB", "2.1 MB", in units of 1,024. */
export function formatSize(bytes: number): string {
  const KIB = 1024;
  if (bytes < KIB) return `${bytes} bytes`;
  if (bytes < KIB * KIB) return `${(bytes / KIB).toFixed(0)} KB`;
  const megabytes = bytes / (KIB * KIB);
  const whole = megabytes - Math.trunc(megabytes) < 0.05 || megabytes >= 10;
  return `${megabytes.toFixed(whole ? 0 : 1)} MB`;
}

/**
 * An image's alt text from its file's `name`, as GitHub's uploader writes it: the name without its
 * extension, its other dots spaces, Markdown's `\`, `[` and `]` escaped, on one line.
 */
export function altText(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  let alt = '';
  for (const character of stem) {
    if (character === '.' || character === '\n' || character === '\r') alt += ' ';
    else if (character === '\\' || character === '[' || character === ']') alt += `\\${character}`;
    else alt += character;
  }
  alt = alt.trim();
  return alt === '' ? 'image' : alt;
}

/**
 * The Markdown that shows an attachment of `kind`, called `name`, at `url`: an image, or for a
 * video, its address alone, which GitHub shows as a player when it's a paragraph of its own.
 */
export function attachmentMarkdown(kind: AttachmentKind, name: string, url: string): string {
  return ATTACHMENT_KINDS[kind].video ? url : `![${altText(name)}](${url})`;
}

/**
 * Whether `url` is an attachment's address as GitHub answers an upload with it, and nothing else
 * that Markdown would read differently: `https://github.com/user-attachments/assets/<id>`.
 */
export function isAssetUrl(url: string): boolean {
  if (!url.startsWith(ASSET_PREFIX)) return false;
  const id = url.slice(ASSET_PREFIX.length);
  return id.length <= 64 && /^[A-Za-z0-9-]+$/.test(id);
}

/** Where an attachment goes: the repository's ID, and whether the account can write to it. */
export interface AttachmentTarget {
  /** GitHub's numeric ID for the repository (REST's `id`, GraphQL's `databaseId`). */
  repositoryId: number;
  /**
   * Whether the account has write access or more, which uploads need; nothing when GitHub didn't
   * say, which leaves it to the upload.
   */
  canWrite: boolean | undefined;
}

/** Where attachments to comments on `repo` go, and whether the account may upload them. */
export function attachmentTarget(client: GithubClient, repo: RepoRef): Promise<AttachmentTarget> {
  return client.get(`/repos/${repo.owner}/${repo.name}`, readTarget);
}

function readTarget(json: unknown): AttachmentTarget {
  const id = isRecord(json) ? json['id'] : undefined;
  if (typeof id !== 'number') {
    throw new GithubError({ kind: 'decode', message: "the repository's answer has no ID" });
  }
  const permissions = isRecord(json) ? json['permissions'] : undefined;
  return {
    repositoryId: id,
    canWrite: isRecord(permissions) ? permissions['push'] === true : undefined,
  };
}

/** How long an upload of `bytes` bytes may take, in milliseconds. */
export function uploadTimeoutMs(bytes: number): number {
  return (30 + Math.floor(bytes / (256 * 1024))) * 1000;
}

/**
 * Uploads `file` to the repository with ID `repositoryId`, as the account. Returns the
 * attachment's address. It's never sent again by itself, as an upload can't be undone, but for
 * once: when GitHub refused the token, and so took nothing, and the client's `onUnauthorized` hands
 * over a new one, as when an expired token is renewed.
 */
export async function uploadAttachment(
  client: GithubClient,
  repositoryId: number,
  file: PreparedAttachment,
): Promise<string> {
  if (client.token === undefined) {
    throw new GithubError({
      kind: 'unauthorized',
      message: 'attaching files needs a signed-in account',
    });
  }
  const query = new URLSearchParams({
    name: file.name,
    content_type: ATTACHMENT_KINDS[file.kind].contentType,
    repository_id: String(repositoryId),
  });
  const uploads = client.urls.uploads.replace(/\/+$/, '');
  // `send` sends a request again only after GitHub refused its token and a new one came.
  const response = await client.send('POST', `${uploads}${UPLOAD_PATH}?${query.toString()}`, {
    body: file.bytes,
    contentType: 'application/octet-stream',
    // A large video takes a while: 30 s, and a second more for each 256 KiB.
    timeoutMs: uploadTimeoutMs(file.bytes.length),
    // An upload's answer is a 201; a redirect isn't followed with the file.
    followRedirects: false,
  });
  if (response.status !== 201) {
    throw new GithubError({
      kind: 'decode',
      message: `GitHub answered ${response.status} where an upload's answer is 201 Created, so Lo put nothing in the comment; GitHub may have the file anyway`,
    });
  }
  const url = response.json(readUploadAnswer);
  if (url === undefined) {
    throw new GithubError({
      kind: 'decode',
      message: "GitHub's answer named no address for the attachment",
    });
  }
  if (!isAssetUrl(url)) {
    throw new GithubError({
      kind: 'decode',
      message: `GitHub's answer named an address Lo doesn't put in comments (${url.split('?')[0] ?? ''})`,
    });
  }
  return url;
}

/** The address in an upload's answer, if it names one. */
function readUploadAnswer(json: unknown): string | undefined {
  const url = isRecord(json) ? json['url'] : undefined;
  return typeof url === 'string' ? url : undefined;
}

/** What the comment box says when GitHub didn't take an upload to `repo`, an `owner/name`. */
export function explainUploadError(error: GithubError, repo: string): string {
  const { detail } = error;
  if (detail.kind === 'notFound' || (detail.kind === 'api' && detail.status === 404)) {
    return `GitHub answered Not Found, as it does when the account can't write to ${repo}, or won't take Lo's sign-in for uploads`;
  }
  if (detail.kind === 'api' && detail.status === 413) {
    return `GitHub said it's too large: ${detail.message}`;
  }
  if (detail.kind === 'api' && detail.status === 422) return `GitHub refused it: ${detail.message}`;
  if (detail.kind === 'network') {
    return `${error.message}. It may have reached GitHub anyway; nothing went into the comment, so attach it again to try once more`;
  }
  return error.message;
}
