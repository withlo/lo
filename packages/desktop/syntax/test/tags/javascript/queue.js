const { EventEmitter } = require('node:events');
const limits = require('./limits.js');

import { retry, backoff as wait } from './retry.js';

export const DEFAULT_SIZE = 16;

export class Queue extends EventEmitter {
  items = [];

  push(item) {
    if (this.items.length >= limits.MAX) throw new RangeError('full');
    this.items.push(item);
    this.emit('push', item);
  }

  async drain(handle) {
    for (const item of this.items) await retry(() => handle(item), wait);
  }
}

export function create(size = DEFAULT_SIZE) {
  return new Queue(size);
}

module.exports.later = function later() {
  return import('./later.js');
};
