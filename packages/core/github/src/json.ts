/** Reading GitHub's JSON answers. */

/** Turns a JSON value into what Lo reads from it, checking as much as it needs to. */
export type Read<T> = (json: unknown) => T;

/**
 * Takes GitHub's JSON as the type its documentation and schema give it, unchecked. Every typed
 * answer Lo reads without checking it field by field goes through here, so the trust is in one
 * place.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters, typescript/no-unsafe-type-assertion
export const unchecked = <T>(json: unknown): T => json as T;
