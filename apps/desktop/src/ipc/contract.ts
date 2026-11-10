// How a feature declares what the window may ask main for, and what main pushes to the window.
// Each feature's `contract.ts` defines one contract. Main validates every request against it, and
// the window's client takes its types from it, so no list of channels exists anywhere else.

import type { z } from 'zod';

/** A reply's type. It exists only for the type checker: main's replies aren't validated. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- it only carries the type.
export class Reply<T> {
  declare readonly type: T;
}

/** Marks a request's reply type: `{ input: z.undefined(), reply: reply<AppInfo>() }`. */
export function reply<T>(): Reply<T> {
  return new Reply<T>();
}

/** A request the window may send: its input's schema and its reply's type. */
export interface RequestSpec<Input extends z.ZodType = z.ZodType, Output = unknown> {
  input: Input;
  reply: Reply<Output>;
}

export interface Contract<
  Feature extends string = string,
  Requests extends Record<string, RequestSpec> = Record<string, RequestSpec>,
  Topics extends Record<string, z.ZodType> = Record<string, z.ZodType>,
> {
  /** The feature's name, which is also its folder's: `features/<feature>/`. */
  readonly feature: Feature;
  readonly requests: Requests;
  /** What main pushes to the window, each with the schema its values follow. */
  readonly topics: Topics;
}

const featureName = /^[a-z][a-z0-9]*$/;
const memberName = /^[a-z][a-zA-Z0-9]*$/;

/** A request's or topic's channel: `<feature>.<name>`, so features can't collide. */
export const channelName = /^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/;

export function channel(feature: string, name: string): string {
  return `${feature}.${name}`;
}

/** Defines a feature's contract. A feature with no requests or no topics passes `{}`. */
export function defineContract<
  const Feature extends string,
  Requests extends Record<string, RequestSpec>,
  Topics extends Record<string, z.ZodType>,
>(
  feature: Feature,
  { requests, topics }: { requests: Requests; topics: Topics },
): Contract<Feature, Requests, Topics> {
  if (!featureName.test(feature)) {
    throw new Error(`A feature's name is lowercase letters and digits, not "${feature}".`);
  }
  for (const name of [...Object.keys(requests), ...Object.keys(topics)]) {
    if (!memberName.test(name)) {
      throw new Error(`${feature}: "${name}" isn't a request or topic name (camelCase).`);
    }
    if (name === 'subscribe') {
      throw new Error(`${feature}: "subscribe" is taken by the window's client.`);
    }
    if (name in requests && name in topics) {
      throw new Error(`${feature}: "${name}" is both a request and a topic.`);
    }
  }
  return { feature, requests, topics };
}

/** What the window passes for a request. */
export type InputOf<Spec> = Spec extends RequestSpec<infer Input> ? z.input<Input> : never;
/** What main's handler receives for a request, once its schema has parsed it. */
export type ParsedOf<Spec> = Spec extends RequestSpec<infer Input> ? z.output<Input> : never;
/** What a request replies with. */
export type ReplyOf<Spec> = Spec extends RequestSpec<z.ZodType, infer Output> ? Output : never;
/** What a topic carries. */
export type ValueOf<Topic> = Topic extends z.ZodType ? z.output<Topic> : never;

/** Why a request failed: a short code and a message meant for people. */
export interface Failure {
  /**
   * `invalid`: the input didn't match the contract. `forbidden`: it didn't come from Lo's page.
   * `unavailable`: no such request. `internal`: the handler failed unexpectedly. A feature may
   * use codes of its own.
   */
  code: string;
  message: string;
}

/** Every reply: never a thrown error's text or a stack. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: Failure };

/** Whether a value has a reply's shape. */
export function isResult(value: unknown): value is Result<unknown> {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  if (value.ok === true) return 'value' in value;
  if (value.ok !== false || !('error' in value)) return false;
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

/**
 * An expected failure, thrown by a handler in main or by the window's client. Its code and
 * message reach the window as they are, so the message must be safe to show.
 */
export class IpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}
