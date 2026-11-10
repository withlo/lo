/**
 * A GitHub token for git to sign in with. Printing it, logging it or turning it into JSON says only
 * `Token(redacted)`, so it can't end up in a log line or an error message by accident.
 * {@link Token.expose} is the one way to read it.
 */
export class Token {
  readonly #value: string;

  /** Wraps a token, trimming the whitespace a file or a command's output leaves around it. */
  constructor(value: string) {
    this.#value = value.trim();
  }

  /** The token itself. Only the variable git's credential helper reads gets it. */
  expose(): string {
    return this.#value;
  }

  /**
   * Whether git can be given the token: not empty, and nothing that would split the credential
   * helper's answer into more lines. GitHub's tokens are letters, digits and underscores.
   */
  get usable(): boolean {
    if (this.#value === '') return false;
    for (const char of this.#value) {
      const code = char.codePointAt(0) ?? 0;
      const control = code < 0x20 || (code >= 0x7f && code < 0xa0);
      if (control || /\s/u.test(char)) return false;
    }
    return true;
  }

  toString(): string {
    return 'Token(redacted)';
  }

  toJSON(): string {
    return this.toString();
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

/**
 * Where git gets the token it signs in with: the account's, read as each fetch starts, since
 * renewing the account's token replaces it, and revokes the one before, while a repository is
 * open. `undefined` signs in as nobody.
 */
export type TokenSource = () => Promise<string | undefined>;
