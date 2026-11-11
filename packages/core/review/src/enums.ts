/** Reading GitHub's enum values, shared by the modules that take GitHub's data. */

/** A value a GitHub enum doesn't have, such as one GitHub added after this build of Lo. */
export class UnknownValue extends Error {
  override name = 'UnknownValue';
  readonly value: string;

  constructor(value: string) {
    super(`GitHub value \`${value}\` isn't one Lo knows`);
    this.value = value;
  }
}

/**
 * Reads `value` as one of `values`, GitHub's names for an enum's values, ignoring case, so
 * GraphQL's `HAS_HOOKS` and REST's `has_hooks` both work. The name it answers is GraphQL's, for a
 * mutation's input. Throws {@link UnknownValue} for anything else.
 */
export function githubEnum<const T extends string>(values: readonly T[], value: string): T {
  const found = knownGithubValue(values, value);
  if (found === undefined) throw new UnknownValue(value);
  return found;
}

/**
 * What a switch over a closed set gives for a value outside it, which only data newer than Lo can
 * hold: `fallback`, chosen so such a value never reads as passing or permissive. `value` is typed
 * `never`, so a case the switch leaves out fails to compile.
 */
export function outsideCase<T>(value: never, fallback: T): T {
  void value;
  return fallback;
}

/**
 * Reads `value` as one of `values`, as {@link githubEnum} does, or gives nothing for anything else,
 * for a caller that reads a value newer than Lo as something of its own.
 */
export function knownGithubValue<const T extends string>(
  values: readonly T[],
  value: string,
): T | undefined {
  return values.find((known) => known.toLowerCase() === value.toLowerCase());
}
