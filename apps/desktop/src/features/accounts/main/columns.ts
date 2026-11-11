// Reading a row's columns as the types the accounts' tables give them. The tables are Lo's own and
// `STRICT`, so a column of another type is a bug: it throws, naming the column but not its value.

import type { Row } from '../../../main/database.ts';

export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new TypeError(`${column} isn't text`);
  return value;
}

export function textOrNothing(row: Row, column: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') throw new TypeError(`${column} isn't text`);
  return value;
}

export function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${column} isn't an integer`);
  }
  return value;
}

export function bytes(row: Row, column: string): Uint8Array {
  const value = row[column];
  if (!(value instanceof Uint8Array)) throw new TypeError(`${column} isn't bytes`);
  return value;
}
