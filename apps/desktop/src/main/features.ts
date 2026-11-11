// Features in main: what each feature's `main/index.ts` exports, how main finds them, and how a
// request reaches a handler. Nothing here calls Electron, so it runs under unit tests; `ipc.ts`
// connects it to Electron's IPC.

import type { z } from 'zod';

import type { Database } from './database.ts';
import type { LocalGit } from './git.ts';
import { createServices, type Provided, type Service } from './services.ts';
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

/** What a feature's main side has to work with, in its `provide`, its handlers and its `start`. */
export interface FeatureContext<C extends Contract> {
  /** Pushes a value to the window on one of the feature's topics. */
  readonly publish: <Topic extends keyof C['topics'] & string>(
    topic: Topic,
    value: ValueOf<C['topics'][Topic]>,
  ) => void;
  /** Lo's database. A feature reads and writes only its own tables, named `<feature>_…`. */
  readonly database: Database;
  /** Git, which only main runs: what Lo found, and the cache of repositories once it's open. */
  readonly git: LocalGit;
  /**
   * One of this feature's own services, or another feature's that it lists in its `uses`. It
   * answers once every feature has provided its services: in `start`, `stop` and handlers, not in
   * `provide`.
   */
  readonly use: <T>(service: Service<T>) => T;
}

/** A function whose parameters are checked both ways, so any handler fits in a list of them. */
type AnyHandler = {
  handle(input: unknown, context: FeatureContext<Contract>): unknown;
}['handle'];

/** A feature as main runs it, its types checked where it was defined. */
export interface Feature {
  readonly contract: Contract;
  /** Other features' services it uses, so it stops before the features that provide them. */
  readonly uses: readonly Service<unknown>[];
  readonly handlers: Readonly<Record<string, AnyHandler>>;
  readonly provide?: ((context: FeatureContext<Contract>) => readonly Provided[]) | undefined;
  readonly start?: ((context: FeatureContext<Contract>) => void) | undefined;
  readonly stop?: ((context: FeatureContext<Contract>) => void | Promise<void>) | undefined;
}

/**
 * Defines a feature's main side: the other features' services it `uses`; a handler for each
 * request in its contract; optionally a `provide` that returns the values of the services its
 * `service.ts` defines, each paired with its service by `provides`; optionally a `start` that runs
 * once before the window opens, for pushing to its topics; and optionally a `stop` that runs as Lo
 * quits, while the database is still open. Every feature's `provide` runs before any feature's
 * `start`. A feature stops before the features whose services it uses, and otherwise the last to
 * start stops first. Each part gets the feature's context. A feature's `main/index.ts` exports
 * this as its default export.
 */
export function defineFeature<C extends Contract>(
  contract: C,
  parts: {
    uses?: readonly Service<unknown>[];
    handlers: Handlers<C>;
    provide?: (context: FeatureContext<C>) => readonly Provided[];
    start?: (context: FeatureContext<C>) => void;
    stop?: (context: FeatureContext<C>) => void | Promise<void>;
  },
): Feature {
  const { uses = [], handlers, provide, start, stop } = parts;
  return { contract, uses, handlers, provide, start, stop };
}

/** How long features may take to stop, in milliseconds. */
export interface StopLimits {
  /** Each feature's own: past it, Lo goes on to the next without waiting. */
  each: number;
  /**
   * All of them: past it, the features not yet stopped aren't, but one stopping goes on to its own
   * limit, and a feature that provides services still stops, with its own limit.
   */
  all: number;
}

export const STOP_LIMITS: StopLimits = { each: 5_000, all: 30_000 };

/**
 * The order features stop in: each before the features whose services it uses, and otherwise the
 * last to start first. Throws when features use each other's services, since none of them could
 * stop first.
 */
export function stopOrder(features: readonly Feature[]): Feature[] {
  const byName = new Map(features.map((feature) => [feature.contract.feature, feature]));
  /** The features that use each one's services, which stop before it. */
  const users = new Map(features.map((feature) => [feature, new Set<Feature>()]));
  for (const user of features) {
    for (const service of user.uses) {
      const provider = byName.get(service.feature);
      if (provider && provider !== user) users.get(provider)?.add(user);
    }
  }
  const order: Feature[] = [];
  const left = [...features];
  while (left.length > 0) {
    const next = left.findLast((feature) =>
      [...(users.get(feature) ?? [])].every((user) => order.includes(user)),
    );
    if (!next) {
      const names = left.map((feature) => feature.contract.feature).join(', ');
      throw new Error(`${names} use each other's services, so none of them can stop first.`);
    }
    order.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return order;
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
  /**
   * Runs each feature's `provide`, checks that every service the features define was provided,
   * then runs each feature's `start`.
   */
  start(): void;
  /**
   * Runs each feature's `stop` once, in {@link stopOrder}, each once the one before it has
   * finished or used up its own limit. Past the limit for them all, the rest aren't stopped,
   * except those that provide services: each still gets its own limit, since what it keeps for
   * the others, such as a renewed token, may need saving. One that fails, or runs late, is
   * reported to `log`, and the others still stop. Resolves once nothing still stopping is within
   * its own limit, so the database can close. Asked again, it answers the same.
   */
  stop(): Promise<void>;
}

export function createRouter(
  features: readonly Feature[],
  options: {
    /** Whether a request from this page's address may reach a handler. */
    isAllowedSender(address: string): boolean;
    /** Sends a pushed value to the window. */
    send(channel: string, value: unknown): void;
    log(message: string, error?: unknown): void;
    /** Lo's database, migrated, for every feature's handlers. */
    database: Database;
    git: LocalGit;
    /** Every service the features' `service.ts` files define, which they must all provide. */
    services: readonly Service<unknown>[];
    /** How long features may take to stop: {@link STOP_LIMITS} unless said otherwise. */
    stopLimits?: StopLimits | undefined;
  },
): Router {
  const services = createServices();
  const ordered = stopOrder(features);
  const context = ({ contract, uses }: Feature): FeatureContext<Contract> => ({
    publish(topic, value) {
      const schema = Object.hasOwn(contract.topics, topic) ? contract.topics[topic] : undefined;
      if (!schema) throw new Error(`${contract.feature} has no topic named ${topic}.`);
      options.send(channel(contract.feature, topic), schema.parse(value));
    },
    database: options.database,
    git: options.git,
    use(service) {
      const own = service.feature === contract.feature;
      if (!own && !uses.some((used) => used.id === service.id)) {
        throw new Error(
          `${contract.feature} uses ${service.id} without listing it in its uses, so it could stop after ${service.feature}.`,
        );
      }
      return services.use(service);
    },
  });
  let stopping: Promise<void> | undefined;

  const requests = new Map<
    string,
    { input: z.ZodType; handle: AnyHandler; context: FeatureContext<Contract> }
  >();
  const contexts = new Map(features.map((feature) => [feature, context(feature)]));
  /** The features that provided a service, which stop even past the limit for all. */
  const providers = new Set<Feature>();
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
      for (const [feature, shared] of contexts) {
        const provided = feature.provide?.(shared) ?? [];
        services.add(feature.contract.feature, provided);
        if (provided.length > 0) providers.add(feature);
      }
      services.ready(options.services);
      for (const { contract, uses } of features) {
        for (const service of uses) {
          if (!services.has(service)) {
            throw new Error(`${contract.feature} uses ${service.id}, which no feature provides.`);
          }
        }
      }
      for (const [{ start }, shared] of contexts) start?.(shared);
    },

    stop() {
      stopping ??= stopAll();
      return stopping;
    },
  };

  async function stopAll(): Promise<void> {
    const limits = options.stopLimits ?? STOP_LIMITS;
    const deadline = Date.now() + limits.all;
    for (const feature of ordered) {
      const { contract, stop } = feature;
      const shared = contexts.get(feature);
      if (!stop || !shared) continue;
      // A provider stops whatever the others took. Every feature using its services has had its
      // turn by now, and it may hold what must be saved, such as a renewed token.
      if (Date.now() >= deadline && !providers.has(feature)) {
        options.log(`${contract.feature} wasn't stopped: features had taken ${limits.all} ms.`);
        continue;
      }
      const stopped = Promise.resolve()
        .then(() => stop(shared))
        .catch((error: unknown) => options.log(`${contract.feature} failed to stop:`, error))
        .then(() => true);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), limits.each);
      });
      const done = await Promise.race([stopped, late]);
      clearTimeout(timer);
      if (!done) {
        options.log(
          `${contract.feature} took over ${limits.each} ms to stop; Lo went on without it.`,
        );
      }
    }
  }
}
