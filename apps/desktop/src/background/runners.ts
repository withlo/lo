// What the background process runs for each job, and the limits it runs under.

import type { ParsedOf, ReplyOf } from '../ipc/contract.ts';
import type { JobContract } from '../ipc/jobs.ts';

export interface Limits {
  /** How long the job may run, in milliseconds, before it's stopped. */
  deadline: number;
  /** How much JavaScript heap the job's worker may use, in megabytes. */
  memory: number;
}

export const defaultLimits: Limits = { deadline: 10_000, memory: 256 };

/** A job's code, typed from its contract, with any limits of its own. */
export type Jobs<C extends JobContract> = {
  [Name in keyof C['jobs']]: {
    run(
      input: ParsedOf<C['jobs'][Name]>,
    ): ReplyOf<C['jobs'][Name]> | Promise<ReplyOf<C['jobs'][Name]>>;
    limits?: Partial<Limits>;
  };
};

/** A function whose parameter is checked both ways, so any job's fits in a list of them. */
type AnyRun = { run(input: unknown): unknown }['run'];

/** A group of jobs as the process runs them, its types checked where it was defined. */
export interface Runner {
  readonly contract: JobContract;
  readonly jobs: Readonly<Record<string, { run: AnyRun; limits?: Partial<Limits> | undefined }>>;
}

/** Defines the code for every job in a contract. */
export function defineRunner<C extends JobContract>(contract: C, jobs: Jobs<C>): Runner {
  return { contract, jobs };
}

/** A job by its full name, `<group>.<job>`, with its limits filled in; own properties only. */
export function findJob(
  runners: readonly Runner[],
  path: string,
): { run: AnyRun; limits: Limits; spec: Runner['contract']['jobs'][string] } | undefined {
  const [group, name] = path.split('.');
  const runner = runners.find((candidate) => candidate.contract.group === group);
  if (
    !runner ||
    !name ||
    !Object.hasOwn(runner.jobs, name) ||
    !Object.hasOwn(runner.contract.jobs, name)
  ) {
    return undefined;
  }
  const job = runner.jobs[name];
  const spec = runner.contract.jobs[name];
  if (!job || !spec) return undefined;
  return { run: job.run, spec, limits: { ...defaultLimits, ...job.limits } };
}

/**
 * Checks the job groups `import.meta.glob` found, keyed by path: each lives in the feature folder
 * its contract names, so no two share a name.
 */
export function loadRunners(modules: Readonly<Record<string, Runner>>): Runner[] {
  return Object.entries(modules).map(([path, runner]) => {
    const folder = /\/features\/([^/]+)\//.exec(path)?.[1];
    if (folder !== runner.contract.group) {
      throw new Error(
        `${path} defines the jobs "${runner.contract.group}", but its folder is "${folder}".`,
      );
    }
    return runner;
  });
}
