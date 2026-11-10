/**
 * Finding credentials in what would be, or is, a fixture. The recorder checks every file before it
 * writes it, and a test checks every committed fixture the same way: no token, nothing shaped like
 * a GitHub token, and no credential field that isn't blank.
 */

import { isObject, parseJson, type Json } from './cassette.ts';

/**
 * GitHub's token shapes: OAuth, personal, user-to-server, server-to-server and refresh tokens, and
 * fine-grained personal access tokens, also with their underscores percent-encoded, as in a URL.
 */
const TOKEN_PATTERN =
  /gh[opsur](?:_|%5[Ff])[A-Za-z0-9]{36,}|github(?:_|%5[Ff])pat(?:_|%5[Ff])(?:[A-Za-z0-9]|_|%5[Ff]){50,}/;

/** An `Authorization` header's value, written as a header or a JSON field. */
const AUTHORIZATION = /\bauthorization["']?\s*[:=]\s*["']?(?:token|bearer|basic)\s+[^\s"']{8,}/i;

/** A bearer token, wherever it's written. */
const BEARER = /\bbearer\s+[A-Za-z0-9._~+/-]{16,}=*/i;

/** A 40-digit hex token, the shape of GitHub's older tokens, beside a key that names a credential. */
const HEX_TOKEN =
  /(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|auth)\w*["']?\s*[:=]\s*["']?[0-9a-f]{40}(?![0-9a-f])/i;

/** A JSON web token: three base64url parts, the first two JSON objects. */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

const CREDENTIAL_WORDS = ['token', 'secret', 'password', 'jwt', 'authorization'];

/**
 * Whether a JSON field named `key` holds a credential, whatever its value looks like: a token
 * (`token`, `access_token`, a private repository's `temp_clone_token` and every other `*_token`),
 * a secret or a password, in snake case or camel case.
 */
export function isCredentialField(key: string): boolean {
  const lower = key.toLowerCase();
  return CREDENTIAL_WORDS.some((word) => {
    const camel = word[0]!.toUpperCase() + word.slice(1);
    return lower === word || lower.endsWith(`_${word}`) || key.endsWith(camel);
  });
}

/** Whether a credential field's value gives nothing away: null, empty or `REDACTED`. */
function isBlank(value: Json): boolean {
  if (value === null) return true;
  if (typeof value === 'string') return value === '' || value === 'REDACTED';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** Blanks every credential field in `value` that holds anything, at any depth. Says whether it blanked any. */
export function blankCredentials(value: Json): boolean {
  let blanked = false;
  if (Array.isArray(value)) {
    for (const item of value) blanked = blankCredentials(item) || blanked;
  } else if (isObject(value)) {
    for (const [key, field] of Object.entries(value)) {
      if (isCredentialField(key) && !isBlank(field)) {
        value[key] = '';
        blanked = true;
      } else {
        blanked = blankCredentials(field) || blanked;
      }
    }
  }
  return blanked;
}

/** Every credential field in `value` that isn't blank, by its JSON pointer, with its value. */
export function unblankedCredentials(value: Json): [pointer: string, value: Json][] {
  const found: [string, Json][] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const [pointer, field] of unblankedCredentials(item)) {
        found.push([`/${index}${pointer}`, field]);
      }
    });
  } else if (isObject(value)) {
    for (const [key, field] of Object.entries(value)) {
      if (isCredentialField(key) && !isBlank(field)) {
        found.push([`/${key}`, field]);
      } else {
        for (const [pointer, inner] of unblankedCredentials(field)) {
          found.push([`/${key}${pointer}`, inner]);
        }
      }
    }
  }
  return found;
}

/** The first credential field in `value` that isn't blank, by its JSON pointer. */
export function unblankedCredential(value: Json): string | undefined {
  return unblankedCredentials(value)[0]?.[0];
}

/**
 * Why `bytes` can't be written to a fixture, if it holds a token: one of `secrets`, as is,
 * percent-encoded or in base64, anything shaped like a GitHub token, or, in JSON, a credential
 * field that isn't blank.
 */
export function findSecret(
  bytes: Uint8Array | string,
  secrets: readonly (Uint8Array | string)[],
): string | undefined {
  const found = findToken(bytes, secrets);
  if (found) return found;
  let json: Json;
  try {
    json = parseJson(text(bytes));
  } catch {
    return undefined;
  }
  if (unblankedCredential(json) !== undefined) {
    return "a credential field, such as a private repository's temp_clone_token";
  }
  return undefined;
}

/**
 * {@link findSecret}'s checks for a token, without its check of credential fields: one of
 * `secrets`, as is, percent-encoded or in base64, or anything shaped like a GitHub token.
 */
export function findToken(
  bytes: Uint8Array | string,
  secrets: readonly (Uint8Array | string)[],
): string | undefined {
  const haystack = toBytes(bytes);
  const needles = secrets.map(toBytes).filter((secret) => secret.length > 0);
  const decoded = percentDecoded(haystack);
  if (needles.some((secret) => haystack.includes(secret) || decoded.includes(secret))) {
    return 'the recording token';
  }
  // Base64 bodies, such as the contents API's, are broken into lines, which JSON escapes.
  const unwrapped = unwrapLines(haystack);
  if (needles.flatMap(base64Forms).some((form) => unwrapped.includes(form))) {
    return 'the recording token, in base64';
  }
  // Latin-1 maps each byte to one character, so the patterns see the bytes as they are.
  const latin1 = haystack.toString('latin1');
  if (TOKEN_PATTERN.test(latin1)) return 'something shaped like a GitHub token';
  if (AUTHORIZATION.test(latin1)) return 'an authorization header';
  if (BEARER.test(latin1)) return 'a bearer token';
  if (HEX_TOKEN.test(latin1)) return 'a 40-digit hex token beside a key that names a credential';
  if (JWT.test(latin1)) return 'a JSON web token';
  return undefined;
}

/** `bytes` with every `%XX` replaced by the byte it stands for. */
function percentDecoded(bytes: Buffer): Buffer {
  const decoded: number[] = [];
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!;
    const high = hexDigit(bytes[index + 1]);
    const low = hexDigit(bytes[index + 2]);
    if (byte === 0x25 && high !== undefined && low !== undefined) {
      decoded.push((high << 4) | low);
      index += 2;
    } else {
      decoded.push(byte);
    }
  }
  return Buffer.from(decoded);
}

function hexDigit(byte: number | undefined): number | undefined {
  if (byte === undefined) return undefined;
  const digit = Number.parseInt(String.fromCharCode(byte), 16);
  return Number.isNaN(digit) ? undefined : digit;
}

/** `bytes` without line breaks, raw or escaped in JSON. */
function unwrapLines(bytes: Buffer): Buffer {
  const unwrapped: number[] = [];
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!;
    const next = bytes[index + 1];
    if (byte === 0x5c && (next === 0x6e || next === 0x72)) {
      index += 1;
    } else if (byte !== 0x0a && byte !== 0x0d) {
      unwrapped.push(byte);
    }
  }
  return Buffer.from(unwrapped);
}

/**
 * What `secret` looks like inside base64, in both alphabets, wherever it starts: the characters
 * that depend on its bytes alone, at each of the three offsets in a 3-byte group.
 */
function base64Forms(secret: Buffer): Buffer[] {
  const forms: Buffer[] = [];
  for (let offset = 0; offset < 3; offset++) {
    const encoded = base64(Buffer.concat([Buffer.alloc(offset), secret]));
    const start = Math.ceil((8 * offset) / 6);
    const end = Math.floor((8 * (offset + secret.length)) / 6);
    const form = encoded.slice(start, end);
    forms.push(Buffer.from(form), Buffer.from(form.replaceAll('+', '-').replaceAll('/', '_')));
  }
  return forms;
}

/** Standard base64, with padding. */
export function base64(bytes: Uint8Array | string): string {
  return toBytes(bytes).toString('base64');
}

function toBytes(value: Uint8Array | string): Buffer {
  return typeof value === 'string'
    ? Buffer.from(value)
    : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function text(value: Uint8Array | string): string {
  return typeof value === 'string' ? value : toBytes(value).toString('utf8');
}
