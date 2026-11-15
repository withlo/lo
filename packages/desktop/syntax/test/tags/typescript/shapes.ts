import { stat as read, type Stats } from 'node:fs/promises';
import * as path from 'node:path';

import { Base, type Shape } from './base.ts';
import { square } from '../math/index.ts';

export { round } from './round.ts';

/** The largest radius a circle may have. */
export const MAX_RADIUS = 100;
let created = 0;

export type Area = number;

export enum Unit {
  Metre,
  Foot = 'ft',
}

export interface Sized {
  size: number;
  grow(by: number): void;
}

export class Circle extends Base implements Shape, Sized {
  size = 1;
  #label = 'circle';

  constructor(readonly radius: number) {
    super();
    created++;
  }

  area(): Area {
    return Math.PI * square(this.radius);
  }

  grow(by: number): void {
    this.size += Math.min(by, MAX_RADIUS);
  }

  toString(): string {
    return `${this.#label} ${created}`;
  }
}

export namespace Circles {
  export const unit = new Circle(1);
}

export const describe = (shape: Shape): string => `${path.sep}${String(shape)}`;

export async function load(file: string): Promise<Stats> {
  return read(file);
}
