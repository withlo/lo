import { GithubError } from './errors.ts';

/** GitHub's token types, told apart by prefix. */
export type TokenKind =
  /** `gho_`: an OAuth app's token, which is what Lo's own sign-in and `gh` produce. */
  | 'oauth'
  /** `ghp_`: a classic personal access token. */
  | 'personal'
  /** `github_pat_`: a fine-grained personal access token. */
  | 'fineGrained'
  /** `ghu_`: a GitHub App's user token. GitHub refuses these for attachment uploads. */
  | 'githubApp'
  | 'unknown';

const PREFIXES: readonly [string, TokenKind][] = [
  ['gho_', 'oauth'],
  ['ghp_', 'personal'],
  ['github_pat_', 'fineGrained'],
  ['ghu_', 'githubApp'],
];

/** What a token is made of: GitHub's tokens are letters, digits and underscores. */
const TOKEN_CHARACTERS = /^[A-Za-z0-9_-]*$/;

/**
 * A GitHub token held in memory. Printing it, logging it or turning it into JSON shows only its
 * kind, so it can't end up in a log line or an error message by accident. {@link Token.expose} is
 * the one way to read it.
 */
export class Token {
  readonly #value: string;

  /**
   * Wraps a token, trimming the whitespace a file or a command's output leaves around it. Refuses
   * anything a token can't hold, such as a line break inside a pasted token, without saying what
   * it was given.
   */
  constructor(value: string) {
    const trimmed = value.trim();
    if (!TOKEN_CHARACTERS.test(trimmed)) {
      throw new GithubError({
        kind: 'tokenUnavailable',
        message: 'it holds characters a GitHub token never has',
      });
    }
    this.#value = trimmed;
  }

  /** The token itself, for an `Authorization` header or the credential store. */
  expose(): string {
    return this.#value;
  }

  get isEmpty(): boolean {
    return this.#value.length === 0;
  }

  /** What kind of token this is, from its prefix. */
  get kind(): TokenKind {
    return PREFIXES.find(([prefix]) => this.#value.startsWith(prefix))?.[1] ?? 'unknown';
  }

  equals(other: Token): boolean {
    return this.#value === other.#value;
  }

  toString(): string {
    return `Token(${this.kind}, redacted)`;
  }

  toJSON(): string {
    return this.toString();
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}
