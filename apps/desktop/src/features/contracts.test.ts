import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import type { Contract } from '../ipc/contract.ts';
import type { JobContract } from '../ipc/jobs.ts';

// Every feature's contract, and every contract for its jobs, found the way the app finds them.
const contracts = import.meta.glob<Contract>('./*/contract.ts', {
  eager: true,
  import: 'contract',
});
const jobContracts = import.meta.glob<JobContract>('./*/jobs.ts', {
  eager: true,
  import: 'contract',
});

/**
 * Where a schema accepts an object with keys it doesn't name: every `z.object` that isn't strict,
 * however deep, as paths into the input.
 */
function looseObjects(schema: unknown, path = 'input'): string[] {
  if (schema instanceof z.ZodObject) {
    const strict = schema.def.catchall instanceof z.ZodNever;
    return [
      ...(strict ? [] : [path]),
      ...Object.entries(schema.shape).flatMap(([key, value]) =>
        looseObjects(value, `${path}.${key}`),
      ),
    ];
  }
  if (schema instanceof z.ZodArray) return looseObjects(schema.element, `${path}[]`);
  if (schema instanceof z.ZodUnion) {
    return schema.options.flatMap((option: unknown) => looseObjects(option, path));
  }
  if (schema instanceof z.ZodPipe) return looseObjects(schema.def.in, path);
  // Optional, nullable, default and the other wrappers.
  if (schema instanceof z.ZodType && 'innerType' in schema.def) {
    return looseObjects(schema.def.innerType, path);
  }
  return [];
}

describe('looseObjects', () => {
  it('finds objects that accept keys they don’t name, however deep', () => {
    expect(looseObjects(z.object({ a: z.string() }))).toEqual(['input']);
    expect(
      looseObjects(
        z.strictObject({
          list: z.array(z.object({})),
          maybe: z.object({}).optional(),
          either: z.union([z.string(), z.object({})]),
          kept: z.strictObject({ deep: z.strictObject({}) }),
        }),
      ),
    ).toEqual(['input.list[]', 'input.maybe', 'input.either']);
  });

  it('passes strict objects and everything else', () => {
    expect(looseObjects(z.strictObject({ a: z.array(z.strictObject({})) }))).toEqual([]);
    expect(looseObjects(z.undefined())).toEqual([]);
  });
});

describe("every feature's contract", () => {
  it('is found', () => {
    expect(Object.keys(contracts).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(contracts))(
    '%s refuses keys its requests don’t name',
    (_path, contract) => {
      const loose = Object.entries(contract.requests).flatMap(([name, spec]) =>
        looseObjects(spec.input).map((where) => `${contract.feature}.${name}: ${where}`),
      );
      expect(loose).toEqual([]);
    },
  );
});

describe("every feature's jobs", () => {
  // Features may have no jobs, so this one test covers however many there are.
  it('refuse keys they don’t name', () => {
    const loose = Object.values(jobContracts).flatMap((contract) =>
      Object.entries(contract.jobs).flatMap(([name, spec]) =>
        looseObjects(spec.input).map((where) => `${contract.group}.${name}: ${where}`),
      ),
    );
    expect(loose).toEqual([]);
  });
});
