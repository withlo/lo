import { GitError } from './errors.ts';

declare const oidBrand: unique symbol;

/**
 * A git object ID: 40 hex digits (SHA-1), or 64 (SHA-256). Always lowercase, so two IDs of one
 * object compare equal. Only {@link parseOid} makes one, so an `Oid` is never a branch name or an
 * option git would read as something else.
 */
export type Oid = string & { readonly [oidBrand]: true };

/** `value` as an object ID, or an error when it isn't one. */
export function parseOid(value: string): Oid {
  const lowercase = value.toLowerCase();
  if (!isOid(lowercase)) throw new GitError({ kind: 'invalid', what: 'commit ID', value });
  return lowercase;
}

function isOid(value: string): value is Oid {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

/** Reads one object ID from git's output, such as `rev-parse`'s. */
export function oidFromOutput(output: Uint8Array): Oid {
  return parseOid(new TextDecoder().decode(output).trim());
}
