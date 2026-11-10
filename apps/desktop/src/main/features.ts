// Features in main: what each feature's `main/index.ts` exports, how main finds them, and how a
// request reaches a handler. Nothing here calls Electron, so it runs under unit tests; `ipc.ts`
// connects it to Electron's IPC.

import type { z } from 'zod';

import type { Database } from './database.ts';
import {
  channel,
  IpcError,
  type Contract,
  type ParsedOf,
  type ReplyOf,
  type Result,
  type ValueOf,
} from '../ipc/contract.ts';

/** A feature's handler for each of its requests, typed from its contract. */
export type Handlers<C extends Contract> = {
  [Name in keyof C['requests']]: (
    input: ParsedOf<C['requests'][Name]>,
    context: FeatureContext<C>,
  ) => ReplyOf<C['requests'][Name]> | Promise<ReplyOf<C['requests'][Name]>>;
};

/** What a feature's main side has to work with, in its handlers and its `start`. */
export interface FeatureContext<C extends Contract> {
  /** Pushes a value to the window on one of the feature's topics. */
  readonly publish: <Topic extends keyof C['topics'] & string>(
    topic: Topic,
    value: ValueOf<C['topics'][Topic]>,
  ) => void;
  /** Lo's database. A feature reads and writes only its own tables, named `<feature>_…`. */
  readonly database: Database;
}

/** A function whose parameters are checked both ways, so any handler fits in a list of them. */
type AnyHandler = {
  handle(input: unknown, context: FeatureContext<Contract>): unknown;
}['handle'];

/** A feature as main runs it, its types checked where it was defined. */
export interface Feature {
  readonly contract: Contract;
  readonly handlers: Readonly<Record<string, AnyHandler>>;
  readonly start?: ((context: FeatureContext<Contract>) => void) | undefined;
}

/**
 * Defines a feature's main side: a handler for each request in its contract, and optionally a
 * `start` that runs once before the window opens, for pushing to its topics. Both get the
 * feature's context. A feature's `main/index.ts` exports this as its default export.
 */
export function defineFeature<C extends Contract>(
  contract: C,
  parts: { handlers: Handlers<C>; start?: (context: FeatureContext<C>) => void },
): Feature {
  return { contract, handlers: parts.handlers, start: parts.start };
}

/**
 * Checks the features `import.meta.glob` found, keyed by path: each lives in the folder its
 * contract names, so no two share a name, and each has a handler for every request.
 */
export function loadFeatures(modules: Readonly<Record<string, Feature>>): Feature[] {
  return Object.entries(modules).map(([path, feature]) => {
    const folder = /\/features\/([^/]+)\//.exec(path)?.[1];
    const { feature: name, requests } = feature.contract;
    if (folder !== name) {
      throw new Error(`${path} defines the feature "${name}", but its folder is "${folder}".`);
    }
    for (const request of Object.keys(requests)) {
      // Its own handler: an inherited property, such as toString, is no handler.
      if (
        !Object.hasOwn(feature.handlers, request) ||
        typeof feature.handlers[request] !== 'function'
      ) {
        throw new Error(`${path} has no handler for ${channel(name, request)}.`);
      }
    }
    return feature;
  });
}

function fail(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

export interface Router {
  /** Every request's channel. */
  readonly channels: readonly string[];
  /**
   * Answers a request from the page at `sender`: refused unless it's Lo's own page, invalid unless
   * its input matches the contract, and otherwise the handler's reply. A handler's unexpected
   * error is reported to `log` and reaches the window only as `internal`.
   */
  answer(channel: string, sender: string | undefined, input: unknown): Promise<Result<unknown>>;
  /** Runs each feature's `start`. */
  start(): void;
}

export function createRouter(
  features: readonly Feature[],
  options: {
    /** Whether a request from this page's address may reach a handler. */
    isAllowedSender(address: string): boolean;
    /** Sends a pushed value to the window. */
    send(channel: string, value: unknown): void;
    log(message: string, error: unknown): void;
    /** Lo's database, migrated, for every feature's handlers. */
    database: Database;
  },
): Router {
  const context = (contract: Contract): FeatureContext<Contract> => ({
    publish(topic, value) {
      const schema = Object.hasOwn(contract.topics, topic) ? contract.topics[topic] : undefined;
      if (!schema) throw new Error(`${contract.feature} has no topic named ${topic}.`);
      options.send(channel(contract.feature, topic), schema.parse(value));
    },
    database: options.database,
  });

  const requests = new Map<
    string,
    { input: z.ZodType; handle: AnyHandler; context: FeatureContext<Contract> }
  >();
  const contexts = new Map(features.map((feature) => [feature, context(feature.contract)]));
  for (const [{ contract, handlers }, shared] of contexts) {
    for (const [name, spec] of Object.entries(contract.requests)) {
      const handle = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
      if (handle) {
        requests.set(channel(contract.feature, name), {
          input: spec.input,
          handle,
          context: shared,
        });
      }
    }
  }

  return {
    channels: [...requests.keys()],

    async answer(name, sender, input) {
      if (sender === undefined || !options.isAllowedSender(sender)) {
        return fail('forbidden', `${name} answers only Lo's own page.`);
      }
      const request = requests.get(name);
      if (!request) return fail('unavailable', `There's no request named ${name}.`);
      const parsed = request.input.safeParse(input);
      if (!parsed.success) {
        const where = parsed.error.issues.map((issue) => issue.path.join('.') || 'input');
        return fail('invalid', `${name} got a malformed request (${where.join(', ')}).`);
      }
      try {
        return { ok: true, value: await request.handle(parsed.data, request.context) };
      } catch (error) {
        if (error instanceof IpcError) return fail(error.code, error.message);
        options.log(`${name} failed:`, error);
        return fail('internal', `${name} failed.`);
      }
    },

    start() {
      for (const [{ start }, shared] of contexts) start?.(shared);
    },
  };
}
