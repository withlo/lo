// Services: what one feature's main side provides for the others, so features share without
// importing each other's main code. A feature's `service.ts` names each of its services with
// `defineService`, and its `provide` hands over their values. Every feature's `provide` runs before
// any feature's `start`, and others reach a service with `use`, in their `start` or a handler, so
// nothing depends on the order features start in. What a feature tells the others about, such as
// an account removed, is a member of its service.

import { channelName } from '../ipc/contract.ts';

/** A value one feature provides for the others, named `<feature>.<name>`. */
export class Service<T> {
  /** The value's type. It exists only for the type checker. */
  declare readonly type: T;
  /** `<feature>.<name>`. */
  readonly id: string;
  /** The feature that provides it, and whose `service.ts` defines it. */
  readonly feature: string;

  constructor(id: string) {
    this.id = id;
    this.feature = id.slice(0, id.indexOf('.'));
  }
}

/**
 * Names a service: `defineService<GithubAccess>('accounts.github')`. A feature's `service.ts`
 * exports its services, and other features import that file to use them.
 */
export function defineService<T>(id: string): Service<T> {
  if (!channelName.test(id)) {
    throw new Error(`A service is named <feature>.<name>, as accounts.github is, not "${id}".`);
  }
  return new Service<T>(id);
}

/** A service and its value, as a feature's `provide` returns them. */
export interface Provided {
  readonly service: Service<unknown>;
  readonly value: unknown;
}

/** Pairs a service with its value, which must be of the service's type. */
export function provides<T>(service: Service<T>, value: T): Provided {
  return { service, value };
}

/**
 * The services every `service.ts` defines, from the modules `import.meta.glob` found, keyed by
 * path. Each must be named for the feature whose folder it's in.
 */
export function findServices(
  modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Service<unknown>[] {
  return Object.entries(modules).flatMap(([path, exports]) => {
    const folder = /\/features\/([^/]+)\//.exec(path)?.[1];
    const services = Object.values(exports).filter((value) => value instanceof Service);
    for (const service of services) {
      if (service.feature !== folder) {
        throw new Error(
          `${path} defines the service ${service.id}, but its folder is "${folder}".`,
        );
      }
    }
    return services;
  });
}

export interface Services {
  /** Takes what `feature`'s `provide` returned: only its own services, each provided once. */
  add(feature: string, provided: readonly Provided[]): void;
  /**
   * Ends providing, once every feature has: checks that each of `defined` was provided, and lets
   * `use` answer from then on.
   */
  ready(defined: readonly Service<unknown>[]): void;
  /** A service's value. Throws while features are still providing, or if none provides it. */
  use<T>(service: Service<T>): T;
}

export function createServices(): Services {
  const values = new Map<string, unknown>();
  let ready = false;
  return {
    add(feature, provided) {
      if (ready) throw new Error(`${feature} provided services after every feature had.`);
      for (const { service, value } of provided) {
        if (service.feature !== feature) {
          throw new Error(
            `${feature} provides ${service.id}, but only ${service.feature} may: each feature provides its own services.`,
          );
        }
        if (values.has(service.id)) throw new Error(`${service.id} is provided twice.`);
        values.set(service.id, value);
      }
    },

    ready(defined) {
      for (const service of defined) {
        if (!values.has(service.id)) {
          throw new Error(
            `The ${service.feature} feature defines ${service.id} in its service.ts, but doesn't provide it.`,
          );
        }
      }
      ready = true;
    },

    use<T>(service: Service<T>): T {
      if (!ready) {
        throw new Error(
          `${service.id} was used while features were still providing theirs. Use a service in start or a handler, so it doesn't matter which feature provides first.`,
        );
      }
      if (!values.has(service.id)) throw new Error(`No feature provides ${service.id}.`);
      // `provides` checked the value against its service's type.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return values.get(service.id) as T;
    },
  };
}
