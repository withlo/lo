// Features in main: what each feature's `main/index.ts` exports, how main finds them, and how a
// request reaches a handler. Nothing here calls Electron, so it runs under unit tests; `ipc.ts`
// connects it to Electron's IPC.

import type { z } from 'zod';

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
  ) => ReplyOf<C['requests'][Name]> | Promise<ReplyOf<C['requests'][Name]>>;
};

/** What a feature's main side can do besides answering requests. */
export interface FeatureContext<C extends Contract> {
  /** Pushes a value to the window on one of the feature's topics. */
  readonly publish: <Topic extends keyof C['topics'] & string>(
    topic: Topic,
    value: ValueOf<C['topics'][Topic]>,
  ) => void;
}

/** A function whose parameter is checked both ways, so any handler fits in a list of them. */
type AnyHandler = { handle(input: unknown): unknown }['handle'];

/** A feature as main runs it, its types checked where it was defined. */
export interface Feature {
  readonly contract: Contract;
  readonly handlers: Readonly<Record<string, AnyHandler>>;
  readonly start?: ((context: FeatureContext<Contract>) => void) | undefined;
}

/**
 * Defines a feature's main side: a handler for each request in its contract, and optionally a
 * `start` that runs once before the window opens, for pushing to its topics. A feature's
 * `main/index.ts` exports this as its default export.
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
      if (typeof feature.handlers[request] !== 'function') {
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
  },
): Router {
  const requests = new Map<string, { input: z.ZodType; handle: AnyHandler }>();
  for (const { contract, handlers } of features) {
    for (const [name, spec] of Object.entries(contract.requests)) {
      const handle = handlers[name];
      if (handle) requests.set(channel(contract.feature, name), { input: spec.input, handle });
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
        return { ok: true, value: await request.handle(parsed.data) };
      } catch (error) {
        if (error instanceof IpcError) return fail(error.code, error.message);
        options.log(`${name} failed:`, error);
        return fail('internal', `${name} failed.`);
      }
    },

    start() {
      for (const { contract, start } of features) {
        start?.({
          publish(topic, value) {
            const schema = contract.topics[topic];
            if (!schema) throw new Error(`${contract.feature} has no topic named ${topic}.`);
            options.send(channel(contract.feature, topic), schema.parse(value));
          },
        });
      }
    },
  };
}
