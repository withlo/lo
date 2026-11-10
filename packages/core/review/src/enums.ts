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
  const found = values.find((known) => known.toLowerCase() === value.toLowerCase());
  if (found === undefined) throw new UnknownValue(value);
  return found;
}
