// A package from nuget.org, as `pin.ts` checks one before recording its hash: a `.nupkg` for each
// platform, from the registry's own host. Each must be
//
// - the file nuget.org's catalog lists, by its SHA-512;
// - signed by its author, the one `signer` names, with a certificate that chains to one of
//   `roots`, a root pinned here by its SHA-256, and that was good when a timestamp authority, whose
//   own certificate chains to one of `roots` too, says the package was signed;
// - the package its signature says it signs: the signature holds the hash of every byte of the
//   package but its own file, `.signature.p7s`, as NuGet hashes it.
//
// NuGet's package signatures are CMS (RFC 5652) in a file of the package itself, with the
// timestamp (RFC 3161) as an unsigned attribute of the author's signature. nuget.org adds its own
// signature as a countersignature, which isn't checked: the author's is the one that says who made
// the package. Each certificate is read by Node's `X509Certificate`, and the rest of the CMS by a
// reader of DER here, which takes only DER's definite lengths.

import { createHash, verify, X509Certificate } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import {
  type Download,
  type Pinned,
  type Platform,
  PLATFORMS,
  unpackMeasured,
} from '../src/index.ts';
import { fetchJson, fetchPart, type Source } from './sources.ts';

/** nuget.org's host, which serves both what it lists and the packages. */
const HOSTS = ['api.nuget.org'];

/** Who must have signed a package, and the roots its certificate, and its timestamp's, chain to. */
export interface Signer {
  /** The signing certificate's subject's organization: "Microsoft Corporation". */
  readonly organization: string;
  /**
   * The roots trusted, each by the SHA-256 of its public key (its DER `SubjectPublicKeyInfo`), in
   * base64, so a copy of a root another root has signed counts as the root.
   */
  readonly roots: readonly string[];
}

/**
 * DigiCert Trusted Root G4, the root Microsoft's code-signing certificates and DigiCert's
 * timestamps chain to: the SHA-256 of its key, as the certificate in macOS's own list of roots
 * holds it (the certificate's SHA-256 is `552F7BDC…0AC89988`).
 */
export const DIGICERT_G4 = 'Wd8xe/qfTwq3ylFNd3IpaqLHZbh2ZNCLluVzmeNkcpw=';

/** What nuget.org's catalog says of a version of a package. */
const CATALOG_ENTRY = z.object({
  id: z.string(),
  version: z.string(),
  packageHash: z.string(),
  packageHashAlgorithm: z.literal('SHA512'),
});

/** What nuget.org's registration says of a version of a package: where its catalog entry is. */
const REGISTRATION = z.object({ catalogEntry: z.string() });

/**
 * A package for each platform from nuget.org: `packages` names each platform's package, and
 * `entry` the file the server starts from in it, signed by `signer`.
 */
export function nuget(
  packages: Readonly<Record<Platform, string>>,
  entry: (platform: Platform) => string,
  signer: Signer,
): Source {
  return async (version, tools) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} isn’t a stable version`);
    const platforms: Partial<Record<Platform, Download>> = {};
    for (const platform of PLATFORMS) {
      const id = packages[platform].toLowerCase();
      const registration = await fetchJson(
        `https://api.nuget.org/v3/registration5-semver1/${id}/${version}.json`,
        REGISTRATION,
        HOSTS,
        tools,
      );
      const catalog = await fetchJson(registration.catalogEntry, CATALOG_ENTRY, HOSTS, tools);
      if (catalog.id.toLowerCase() !== id || catalog.version !== version) {
        throw new Error(`nuget.org’s catalog lists ${catalog.id} ${catalog.version}, not ${id}`);
      }
      const url = `https://api.nuget.org/v3-flatcontainer/${id}/${version}/${id}.${version}.nupkg`;
      const folder = await mkdtemp(join(tools.folder, 'nuget-'));
      try {
        const inside = { ...tools, folder };
        const { part, file } = await fetchPart(url, HOSTS, inside);
        const data = await readFile(file);
        if (createHash('sha512').update(data).digest('base64') !== catalog.packageHash) {
          throw new Error(`${id} ${version} isn’t the package nuget.org’s catalog lists`);
        }
        const signed = verifyPackage(data, signer);
        tools.log(
          `${id} ${version} is signed by ${signed.subject}, at ${signed.at.toISOString()}.`,
        );
        const download: Download = { kind: 'zip', ...part, entry: entry(platform) };
        const into = join(await mkdtemp(join(folder, 'unpacked-')), 'files');
        await mkdir(into);
        const { bytes } = await unpackMeasured(download, [file], into);
        tools.log(`It unpacks as Lo would, to ${bytes} bytes, with ${download.entry} inside.`);
        platforms[platform] = { ...download, unpacked: bytes };
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    }
    const pinned: Pinned = { version, hosts: HOSTS, platforms };
    return pinned;
  };
}

/** The signature file of a signed package, the last of its entries. */
const SIGNATURE = '.signature.p7s';

/**
 * Checks that `pkg`, a `.nupkg`'s bytes, is signed by `signer` and is what its signature signs,
 * and says whose certificate signed it and when its timestamp says it was.
 */
export function verifyPackage(
  pkg: Buffer,
  signer: Signer,
): { readonly subject: string; readonly at: Date } {
  const signature = signatureFile(pkg);
  const { content, at, certificate } = verifyAuthorSignature(signature, signer);
  const claimed = /^Version:1\r?\n\r?\n([0-9.]+)-Hash:([A-Za-z0-9+/=]+)\r?\n/.exec(
    content.toString('latin1'),
  );
  const algorithm = claimed?.[1] === undefined ? undefined : HASHES.get(claimed[1]);
  if (claimed?.[2] === undefined || algorithm === undefined) {
    throw new Error('Its signature names no hash pin.ts reads');
  }
  if (contentHash(pkg, algorithm).toString('base64') !== claimed[2]) {
    throw new Error('It isn’t the package its signature signs');
  }
  return { subject: certificate.subject.replaceAll('\n', ', '), at };
}

/** The hashes signatures name, by their OIDs, as Node names them. */
const HASHES: ReadonlyMap<string, string> = new Map([
  ['2.16.840.1.101.3.4.2.1', 'sha256'],
  ['2.16.840.1.101.3.4.2.2', 'sha384'],
  ['2.16.840.1.101.3.4.2.3', 'sha512'],
]);

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  data: '1.2.840.113549.1.7.1',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  messageDigest: '1.2.840.113549.1.9.4',
  timestampToken: '1.2.840.113549.1.9.16.2.14',
  commitmentType: '1.2.840.113549.1.9.16.2.16',
  proofOfOrigin: '1.2.840.113549.1.9.16.6.1',
  codeSigning: '1.3.6.1.5.5.7.3.3',
  timeStamping: '1.3.6.1.5.5.7.3.8',
  rsa: '1.2.840.113549.1.1.1',
  rsaWith: [
    '1.2.840.113549.1.1.11',
    '1.2.840.113549.1.1.12',
    '1.2.840.113549.1.1.13',
  ] as readonly string[],
} as const;

/**
 * Checks the author's signature in `signature`, a package's `.signature.p7s`: CMS signed by the
 * certificate of `signer`'s organization, for code signing, as its author's ("proof of origin"),
 * chaining to one of its roots and good when its timestamp says it signed. It says what it signs,
 * when, and with which certificate.
 */
export function verifyAuthorSignature(
  signature: Buffer,
  signer: Signer,
): { readonly content: Buffer; readonly at: Date; readonly certificate: X509Certificate } {
  const signed = signedData(signature);
  if (signed.contentType !== OID.data) throw new Error('Its signature signs no data');
  const info = only(signed.signers, 'signature');
  if (!attributeValues(info.signedAttributes, OID.commitmentType).some(isProofOfOrigin)) {
    throw new Error('Its signature isn’t its author’s');
  }
  const [token, ...more] = attributeValues(info.unsignedAttributes, OID.timestampToken);
  if (token === undefined || more.length > 0) throw new Error('Its signature has no timestamp');
  const stamp = verifyTimestamp(token.bytes, info.signature, signer.roots);
  const certificate = verifySigner(signed, info, stamp, signer.roots, OID.codeSigning);
  if (!certificate.subject.split('\n').includes(`O=${signer.organization}`)) {
    throw new Error(`Its signature isn’t ${signer.organization}’s: ${certificate.subject}`);
  }
  return { content: signed.content, at: stamp, certificate };
}

/** Whether a commitment type attribute's value says the signer is the package's author. */
function isProofOfOrigin(value: Der): boolean {
  return value.children()[0]?.oid() === OID.proofOfOrigin;
}

/**
 * Checks the timestamp `token` on `signed`, a signature's value, and says when it says that was:
 * a timestamp authority's CMS, for timestamping, chaining to one of `roots` and good at that time,
 * over the hash of `signed`.
 */
function verifyTimestamp(token: Buffer, signed: Buffer, roots: readonly string[]): Date {
  const stamp = signedData(token);
  if (stamp.contentType !== OID.tstInfo) throw new Error('Its timestamp stamps nothing');
  const [, , imprint, , time] = parse(stamp.content).children();
  const [algorithm, hashed] = imprint?.children() ?? [];
  const hash = HASHES.get(algorithm?.children()[0]?.oid() ?? '');
  if (hash === undefined || hashed === undefined || time === undefined) {
    throw new Error('Its timestamp isn’t one pin.ts reads');
  }
  if (!createHash(hash).update(signed).digest().equals(hashed.value)) {
    throw new Error('Its timestamp stamps another signature');
  }
  const at = time.time();
  verifySigner(stamp, only(stamp.signers, 'timestamp signature'), at, roots, OID.timeStamping);
  return at;
}

/**
 * Checks that `info` signs `data`'s content, and its attributes, with a certificate of `data`'s for
 * `usage` that chains to one of `roots` and that was good, as was each certificate above it, at
 * `at`. It returns that certificate.
 */
function verifySigner(
  data: SignedData,
  info: SignerInfo,
  at: Date,
  roots: readonly string[],
  usage: string,
): X509Certificate {
  const hash = HASHES.get(info.digestAlgorithm);
  if (hash === undefined) throw new Error(`A signature hashes with ${info.digestAlgorithm}`);
  if (info.signatureAlgorithm !== OID.rsa && !OID.rsaWith.includes(info.signatureAlgorithm)) {
    throw new Error(
      `A signature signs with ${info.signatureAlgorithm}, which pin.ts doesn’t check`,
    );
  }
  const [digest, ...others] = attributeValues(info.signedAttributes, OID.messageDigest);
  if (digest === undefined || others.length > 0) throw new Error('A signature has no digest');
  if (!createHash(hash).update(data.content).digest().equals(digest.value)) {
    throw new Error('A signature signs other content');
  }
  const certificate = data.certificates.find((each) => isSigner(each, info));
  if (certificate === undefined) throw new Error('A signature’s certificate isn’t in it');
  // What's signed is the attributes, as a SET rather than the field's implicit tag.
  const attributes = Buffer.from(info.signedAttributes.bytes);
  attributes[0] = 0x31;
  if (!verify(hash, attributes, certificate.publicKey, info.signature)) {
    throw new Error('A signature doesn’t verify');
  }
  if (!(certificate.keyUsage ?? []).includes(usage)) {
    throw new Error(`A signature’s certificate isn’t for ${usage}`);
  }
  chain(certificate, data.certificates, at, roots);
  return certificate;
}

/** The most certificates between a signer and its root. */
const CHAIN_LENGTH = 5;

/**
 * Checks that `leaf` chains, through `pool`, to one of `roots`, by its key, each certificate
 * signed by the next, each above the leaf a CA, and each good at `at`.
 */
function chain(
  leaf: X509Certificate,
  pool: readonly X509Certificate[],
  at: Date,
  roots: readonly string[],
): void {
  let current = leaf;
  for (let depth = 0; depth <= CHAIN_LENGTH; depth += 1) {
    if (at < current.validFromDate || at > current.validToDate) {
      throw new Error(
        `${current.subject.replaceAll('\n', ', ')} wasn’t good at ${at.toISOString()}`,
      );
    }
    if (depth > 0 && !current.ca) throw new Error(`${current.subject} isn’t a CA`);
    if (roots.includes(keyHash(current))) return;
    const issuer = pool.find(
      (each) => each !== current && current.checkIssued(each) && current.verify(each.publicKey),
    );
    if (issuer === undefined) {
      throw new Error(
        `${current.subject.replaceAll('\n', ', ')} doesn’t chain to a root pin.ts trusts`,
      );
    }
    current = issuer;
  }
  throw new Error('A certificate chain is too long');
}

/** The SHA-256 of `certificate`'s public key, as its DER `SubjectPublicKeyInfo`, in base64. */
function keyHash(certificate: X509Certificate): string {
  const key = certificate.publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(key).digest('base64');
}

/** The subject key identifier extension's OID. */
const SUBJECT_KEY = '2.5.29.14';

/**
 * Whether `certificate` is the one `info` names: by its issuer and serial number, or by its
 * subject key identifier.
 */
function isSigner(certificate: X509Certificate, info: SignerInfo): boolean {
  const [tbs] = parse(certificate.raw).children();
  const fields = tbs?.children() ?? [];
  const { sid } = info;
  if (sid.kind === 'key') {
    // The extensions are [3], last; each is its OID, perhaps whether it's critical, and its value.
    const extensions =
      fields
        .find((field) => field.tag === 0xa3)
        ?.children()[0]
        ?.children() ?? [];
    const found = extensions.find((extension) => extension.children()[0]?.oid() === SUBJECT_KEY);
    const value = found?.children().at(-1);
    return value !== undefined && parse(value.value).value.equals(sid.id);
  }
  // The version, when it's there, is [0].
  const at = fields[0]?.tag === 0xa0 ? 1 : 0;
  const serial = fields[at];
  const issuer = fields[at + 2];
  return (
    serial !== undefined &&
    issuer !== undefined &&
    serial.bytes.equals(sid.serial) &&
    issuer.bytes.equals(sid.issuer)
  );
}

/** A CMS signed-data, as far as pin.ts reads one. */
interface SignedData {
  readonly contentType: string;
  readonly content: Buffer;
  readonly certificates: readonly X509Certificate[];
  readonly signers: readonly SignerInfo[];
}

/** A signer's part of a signed-data. */
interface SignerInfo {
  /**
   * How it names its certificate: by the DER of its issuer and of its serial number, or by its
   * subject key identifier.
   */
  readonly sid:
    | { readonly kind: 'issuer'; readonly issuer: Buffer; readonly serial: Buffer }
    | { readonly kind: 'key'; readonly id: Buffer };
  readonly digestAlgorithm: string;
  /** Its signed attributes, as they're encoded: `[0]`, implicitly a SET. */
  readonly signedAttributes: Der;
  readonly signatureAlgorithm: string;
  readonly signature: Buffer;
  readonly unsignedAttributes: Der | undefined;
}

/** Reads `bytes`, a CMS content info holding a signed-data with its content in it. */
function signedData(bytes: Buffer): SignedData {
  const [type, wrapped] = parse(bytes).children();
  if (type?.oid() !== OID.signedData || wrapped?.tag !== 0xa0) {
    throw new Error('It isn’t a CMS signed-data');
  }
  const fields = only(wrapped.children(), 'signed-data').children();
  const encapsulated = fields[2];
  const [contentType, explicit] = encapsulated?.children() ?? [];
  const content = explicit?.tag === 0xa0 ? explicit.children()[0] : undefined;
  if (contentType === undefined || content?.tag !== 0x04) {
    throw new Error('Its signed-data holds no content');
  }
  const rest = fields.slice(3);
  const certificates = rest.find((field) => field.tag === 0xa0);
  const signerInfos = rest.at(-1);
  if (signerInfos?.tag !== 0x31) throw new Error('Its signed-data has no signers');
  return {
    contentType: contentType.oid(),
    content: content.value,
    certificates: (certificates?.children() ?? [])
      .filter((each) => each.tag === 0x30)
      .map((each) => new X509Certificate(each.bytes)),
    signers: signerInfos.children().map(signerInfo),
  };
}

/** Reads one signer's info. */
function signerInfo(der: Der): SignerInfo {
  const [, sid, digest, signed, algorithm, signature, unsigned] = der.children();
  const [issuer, serial] = sid?.tag === 0x30 ? sid.children() : [];
  const named =
    issuer !== undefined && serial !== undefined
      ? ({ kind: 'issuer', issuer: issuer.bytes, serial: serial.bytes } as const)
      : sid?.tag === 0x80
        ? ({ kind: 'key', id: sid.value } as const)
        : undefined;
  if (
    named === undefined ||
    digest === undefined ||
    signed?.tag !== 0xa0 ||
    algorithm === undefined ||
    signature?.tag !== 0x04
  ) {
    throw new Error('A signer isn’t one pin.ts reads');
  }
  return {
    sid: named,
    digestAlgorithm: digest.children()[0]?.oid() ?? '',
    signedAttributes: signed,
    signatureAlgorithm: algorithm.children()[0]?.oid() ?? '',
    signature: signature.value,
    unsignedAttributes: unsigned?.tag === 0xa1 ? unsigned : undefined,
  };
}

/** The values of each attribute of `type` in `attributes`, a SET of them. */
function attributeValues(attributes: Der | undefined, type: string): Der[] {
  return (attributes?.children() ?? []).flatMap((attribute) => {
    const [name, values] = attribute.children();
    return name?.oid() === type && values !== undefined ? values.children() : [];
  });
}

/** The one item of `items`, or an error naming `what`. */
function only<T>(items: readonly T[], what: string): T {
  const [item, ...more] = items;
  if (item === undefined || more.length > 0)
    throw new Error(`It has more or less than one ${what}`);
  return item;
}

/** A DER value: its tag, its whole encoding, and its contents. */
export interface Der {
  readonly tag: number;
  /** Its tag, length and contents. */
  readonly bytes: Buffer;
  /** Its contents. */
  readonly value: Buffer;
  /** The values it holds, for one that's constructed. */
  children(): Der[];
  /** It as an object identifier, dotted. */
  oid(): string;
  /** It as a UTC or generalized time. */
  time(): Date;
}

/** Reads the one DER value `bytes` holds, which must fill them. */
export function parse(bytes: Buffer): Der {
  const der = readAt(bytes, 0);
  if (der.bytes.length !== bytes.length) throw new Error('It has more than one DER value');
  return der;
}

/** The most bytes a DER length may take. */
const LENGTH_BYTES = 4;

function readAt(bytes: Buffer, start: number): Der {
  const tag = bytes[start];
  const first = bytes[start + 1];
  if (tag === undefined || first === undefined || (tag & 0x1f) === 0x1f) {
    throw new Error('It isn’t DER pin.ts reads');
  }
  let length = first;
  let header = 2;
  if (first & 0x80) {
    const count = first & 0x7f;
    // DER has no indefinite length.
    if (count === 0 || count > LENGTH_BYTES) throw new Error('It isn’t DER pin.ts reads');
    length = 0;
    for (let at = 0; at < count; at += 1) {
      const byte = bytes[start + 2 + at];
      if (byte === undefined) throw new Error('It ends inside a DER length');
      length = length * 256 + byte;
    }
    header += count;
  }
  const end = start + header + length;
  if (end > bytes.length) throw new Error('A DER value runs past its end');
  const whole = bytes.subarray(start, end);
  const value = bytes.subarray(start + header, end);
  return {
    tag,
    bytes: whole,
    value,
    children() {
      if (!(tag & 0x20)) throw new Error('A DER value holds no others');
      const found: Der[] = [];
      for (let at = 0; at < value.length;) {
        const child = readAt(value, at);
        found.push(child);
        at += child.bytes.length;
      }
      return found;
    },
    oid() {
      if (tag !== 0x06 || value.length === 0) throw new Error('A DER value isn’t an OID');
      const parts: number[] = [];
      let part = 0;
      for (const byte of value) {
        part = part * 128 + (byte & 0x7f);
        if (byte & 0x80) continue;
        parts.push(part);
        part = 0;
      }
      // The first number holds the first two arcs.
      const [lead = 0, ...rest] = parts;
      const arc = Math.min(2, Math.floor(lead / 40));
      return [arc, lead - arc * 40, ...rest].join('.');
    },
    time() {
      const text = value.toString('latin1');
      const utc = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
      const general = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/.exec(text);
      const parts = tag === 0x17 ? utc : tag === 0x18 ? general : null;
      if (parts === null) throw new Error('A DER value isn’t a time pin.ts reads');
      const [, y, mo, d, h, mi, s] = parts.map(Number);
      const year = tag === 0x17 ? ((y ?? 0) < 50 ? 2000 : 1900) + (y ?? 0) : (y ?? 0);
      return new Date(Date.UTC(year, (mo ?? 1) - 1, d, h, mi, s));
    },
  };
}

/** A zip's end of central directory record: its signature, and its least size. */
const END = { signature: 0x06054b50, size: 22 };
/** A central directory header's signature and fixed size. */
const CENTRAL = { signature: 0x02014b50, size: 46 };
/** A local file header's signature and fixed size. */
const LOCAL = { signature: 0x04034b50, size: 30 };

/** A signed package, as a zip: its end record and the signature's entry, its last. */
interface Signed {
  /** Where its end of central directory record starts. */
  readonly end: number;
  readonly entries: number;
  /** Its central directory's size and offset. */
  readonly size: number;
  readonly offset: number;
  /** The signature's central directory header: where it starts and how long it is. */
  readonly header: { readonly start: number; readonly length: number };
  /** The signature's local header, and how long its local entry is. */
  readonly local: number;
  readonly localLength: number;
}

/**
 * Reads the zip `pkg` as a signed package: the signature must be its last entry, and its header
 * the central directory's last, as NuGet writes them.
 */
function signedZip(pkg: Buffer): Signed {
  const end = pkg.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || pkg.length - end < END.size || pkg.readUInt32LE(end) !== END.signature) {
    throw new Error('It isn’t a zip');
  }
  const entries = pkg.readUInt16LE(end + 10);
  const size = pkg.readUInt32LE(end + 12);
  const offset = pkg.readUInt32LE(end + 16);
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new Error('It’s a zip64, which pin.ts doesn’t read');
  }
  if (offset + size !== end) throw new Error('Its central directory isn’t where it says');
  const headers: { start: number; length: number; name: string; local: number }[] = [];
  for (let at = offset; at < end;) {
    if (at + CENTRAL.size > end || pkg.readUInt32LE(at) !== CENTRAL.signature) {
      throw new Error('Its central directory is broken');
    }
    const nameLength = pkg.readUInt16LE(at + 28);
    const length =
      CENTRAL.size + nameLength + pkg.readUInt16LE(at + 30) + pkg.readUInt16LE(at + 32);
    const name = pkg.toString('utf8', at + CENTRAL.size, at + CENTRAL.size + nameLength);
    headers.push({ start: at, length, name, local: pkg.readUInt32LE(at + 42) });
    at += length;
  }
  if (headers.length !== entries) throw new Error('Its central directory counts its entries wrong');
  const header = headers.at(-1);
  if (header?.name !== SIGNATURE) throw new Error(`Its last entry isn’t ${SIGNATURE}`);
  if (headers.some((each) => each !== header && each.local >= header.local)) {
    throw new Error(`Its ${SIGNATURE} isn’t the last of its files`);
  }
  if (pkg.readUInt32LE(header.local) !== LOCAL.signature)
    throw new Error('Its signature is broken');
  return {
    end,
    entries,
    size,
    offset,
    header,
    local: header.local,
    // The signature's local header and data run to the central directory.
    localLength: offset - header.local,
  };
}

/** The signature file of the signed package `pkg`, which NuGet stores uncompressed. */
export function signatureFile(pkg: Buffer): Buffer {
  const { header, local, offset } = signedZip(pkg);
  if (pkg.readUInt16LE(header.start + 10) !== 0) throw new Error(`Its ${SIGNATURE} is compressed`);
  const length = pkg.readUInt32LE(header.start + 20);
  const data = local + LOCAL.size + pkg.readUInt16LE(local + 26) + pkg.readUInt16LE(local + 28);
  if (data + length > offset) throw new Error(`Its ${SIGNATURE} runs past its entry`);
  return pkg.subarray(data, data + length);
}

/**
 * The hash, with `algorithm`, NuGet signs for the package `pkg`: of every byte of it but its
 * signature file, as if that had never been added. It's the package's local headers and data
 * before the signature's, the central directory but the signature's header, and the end of
 * central directory record, with the signature taken out of its counts, size and offset.
 */
export function contentHash(pkg: Buffer, algorithm: string): Buffer {
  const { end, entries, size, offset, header, local, localLength } = signedZip(pkg);
  const record = Buffer.from(pkg.subarray(end));
  record.writeUInt16LE(entries - 1, 8);
  record.writeUInt16LE(entries - 1, 10);
  record.writeUInt32LE(size - header.length, 12);
  record.writeUInt32LE(offset - localLength, 16);
  return createHash(algorithm)
    .update(pkg.subarray(0, local))
    .update(pkg.subarray(offset, header.start))
    .update(record)
    .digest();
}
