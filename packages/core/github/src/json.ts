/** Reading GitHub's JSON answers. */

import { GithubError } from './errors.ts';
import { isRecord } from './graphql.ts';

/** Turns a JSON value into what Lo reads from it, checking as much as it needs to. */
export type Read<T> = (json: unknown) => T;

/**
 * Takes GitHub's JSON as the type its documentation and schema give it, unchecked. Every typed
 * answer Lo reads without checking it field by field goes through here, so the trust is in one
 * place.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters, typescript/no-unsafe-type-assertion
export const unchecked = <T>(json: unknown): T => json as T;

/**
 * An object in GitHub's answer, read field by field: a field that isn't what Lo reads it as is a
 * decode error naming it. A field GitHub may leave out also reads as nothing when it's `null`.
 */
export class Fields {
  readonly #json: Record<string, unknown>;
  readonly #path: string;

  constructor(json: unknown, path: string) {
    if (!isRecord(json)) throw unexpected(`${path} isn't an object`);
    this.#json = json;
    this.#path = path;
  }

  text(key: string): string {
    const value = this.#json[key];
    if (typeof value !== 'string') throw this.#wrong(key, 'a string');
    return value;
  }

  maybeText(key: string): string | undefined {
    return this.#present(key) ? this.text(key) : undefined;
  }

  integer(key: string): number {
    const value = this.#json[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw this.#wrong(key, 'a whole number');
    }
    return value;
  }

  maybeInteger(key: string): number | undefined {
    return this.#present(key) ? this.integer(key) : undefined;
  }

  /** A boolean that reads as `false` when GitHub leaves it out. */
  flag(key: string): boolean {
    const value = this.#json[key];
    if (value === undefined) return false;
    if (typeof value !== 'boolean') throw this.#wrong(key, 'true or false');
    return value;
  }

  /** A boolean, or nothing when GitHub leaves it out. */
  maybeFlag(key: string): boolean | undefined {
    return this.#present(key) ? this.flag(key) : undefined;
  }

  /** The field as GitHub gave it, for a reader of its own. */
  raw(key: string): unknown {
    return this.#json[key];
  }

  fields(key: string): Fields {
    return new Fields(this.#json[key], `${this.#path}.${key}`);
  }

  maybeFields(key: string): Fields | undefined {
    return this.#present(key) ? this.fields(key) : undefined;
  }

  #present(key: string): boolean {
    const value = this.#json[key];
    return value !== undefined && value !== null;
  }

  #wrong(key: string, what: string): GithubError {
    return unexpected(`${this.#path}.${key} isn't ${what}`);
  }
}

function unexpected(message: string): GithubError {
  return new GithubError({ kind: 'decode', message });
}
