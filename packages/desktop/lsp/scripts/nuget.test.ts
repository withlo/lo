// pin.ts's checks of a NuGet package: what it hashes of a package, and Microsoft's real signature
// of Roslyn's package for macOS on Arm, from `signatures/`, checked as pin.ts checks it, in
// packages the test makes, so none is downloaded.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { zip, type ZipEntry } from '../test/downloads.ts';
import {
  chain,
  contentHash,
  DIGICERT_G4,
  parse,
  signatureFile,
  signedData,
  type Signer,
  verifyAuthorSignature,
  verifyPackage,
} from './nuget.ts';

/** The `.signature.p7s` of `roslyn-language-server.osx-arm64` 5.11.0, as nuget.org serves it. */
const SIGNATURE = readFileSync(
  join(import.meta.dirname, 'signatures', 'roslyn-language-server.osx-arm64.5.11.0.p7s'),
);

const MICROSOFT: Signer = { organization: 'Microsoft Corporation', roots: [DIGICERT_G4] };

/** A package's files, as a `.nupkg` holds them, without its signature. */
const FILES: readonly ZipEntry[] = [
  { path: 'server.nuspec', data: '<package />' },
  { path: 'tools/net10.0/server.dll', data: 'the server' },
];

/** A package of `FILES` and `signature`, last, as NuGet signs one. */
function signed(signature: Buffer): Buffer {
  return zip([...FILES, { path: '.signature.p7s', data: signature }]);
}

test('hashes a package as NuGet does: every byte but its signature’s, as if it had none', () => {
  const pkg = signed(SIGNATURE);
  expect(signatureFile(pkg).equals(SIGNATURE)).toBe(true);
  const unsigned = createHash('sha512').update(zip(FILES)).digest();
  expect(contentHash(pkg, 'sha512').equals(unsigned)).toBe(true);
});

test('reads a signature only as the last of a package’s files', () => {
  const first = zip([{ path: '.signature.p7s', data: SIGNATURE }, ...FILES]);
  expect(() => signatureFile(first)).toThrow('Its last entry isn’t .signature.p7s');
  expect(() => signatureFile(zip(FILES))).toThrow('Its last entry isn’t .signature.p7s');
  expect(() => signatureFile(Buffer.from('not a zip'))).toThrow('It isn’t a zip');
});

test('takes Microsoft’s signature as its author’s, timestamped, chaining to DigiCert’s root', () => {
  const { at, certificate, content } = verifyAuthorSignature(SIGNATURE, MICROSOFT);
  expect(certificate.subject).toContain('O=Microsoft Corporation');
  expect(at.toISOString()).toBe('2026-07-30T23:37:26.000Z');
  // What it signs is the SHA-256 of the package it came from, as NuGet hashes it.
  expect(content.toString('latin1')).toBe(
    'Version:1\n\n2.16.840.1.101.3.4.2.1-Hash:3Xbvd99tSuS0ox4nN7zC6BFQB7cLJOhcsLKg96VkTuQ=\n\n',
  );
});

test('refuses the signature in a package it doesn’t sign', () => {
  expect(() => verifyPackage(signed(SIGNATURE), MICROSOFT)).toThrow(
    'It isn’t the package its signature signs',
  );
});

test('refuses a signature by another organization, or chaining to another root', () => {
  expect(() =>
    verifyAuthorSignature(SIGNATURE, { ...MICROSOFT, organization: 'Lo Hostile' }),
  ).toThrow('Its signature isn’t Lo Hostile’s');
  const other = createHash('sha256').update('another root').digest('base64');
  expect(() => verifyAuthorSignature(SIGNATURE, { ...MICROSOFT, roots: [other] })).toThrow(
    'doesn’t chain to a root pin.ts trusts',
  );
});

test('refuses a signature whose content, or whose signed value, was changed', () => {
  // The hash it signs, one character changed: its digest no longer matches.
  const content = Buffer.from(SIGNATURE);
  const hash = content.indexOf('-Hash:') + '-Hash:'.length;
  content[hash] = content[hash] === 0x41 ? 0x42 : 0x41;
  expect(() => verifyAuthorSignature(content, MICROSOFT)).toThrow(
    'A signature signs other content',
  );
  // A byte of it cut: it's no longer DER.
  expect(() => verifyAuthorSignature(SIGNATURE.subarray(0, -1), MICROSOFT)).toThrow(
    'A DER value runs past its end',
  );
});

test('refuses a timestamp that stamps another signature', () => {
  // The signer's signature value, one byte changed: the timestamp's hash of it no longer matches.
  const [, wrapped] = parse(SIGNATURE).children();
  const signers = wrapped?.children()[0]?.children().at(-1);
  const value = signers?.children()[0]?.children()[5]?.value;
  if (value === undefined) throw new Error('the signature has no signer’s value');
  const changed = Buffer.from(SIGNATURE);
  const at = SIGNATURE.indexOf(value) + 10;
  changed[at] = (changed[at] ?? 0) ^ 0xff;
  expect(() => verifyAuthorSignature(changed, MICROSOFT)).toThrow(
    'Its timestamp stamps another signature',
  );
});

test('refuses a certificate that wasn’t good when the timestamp says it signed', () => {
  const { at, certificate } = verifyAuthorSignature(SIGNATURE, MICROSOFT);
  const { certificates } = signedData(SIGNATURE);
  expect(() => chain(certificate, certificates, at, MICROSOFT.roots)).not.toThrow();
  // A second before it was issued, and a second after it expired.
  for (const time of [
    certificate.validFromDate.getTime() - 1000,
    certificate.validToDate.getTime() + 1000,
  ]) {
    const when = new Date(time);
    expect(() => chain(certificate, certificates, when, MICROSOFT.roots)).toThrow(
      `wasn’t good at ${when.toISOString()}`,
    );
  }
});
