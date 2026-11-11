// Reads a diff of `workerData.files` files, made up, in a thread whose heap is kept small, and
// says how it went.

import { parentPort, workerData } from 'node:worker_threads';

import { parseChanges, rawDiffBlobs } from '../src/diff.ts';
import { GitError } from '../src/errors.ts';

const files = Number(workerData);
const header = `:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} M\0`;
const path = (index: number) => `folder/file-${String(index).padStart(7, '0')}.txt\0`;
const record = header.length + path(0).length;
const numstat = `1\t1\t${path(0)}`.length;
// Written straight into a buffer, outside the heap, as git's output comes in.
const raw = Buffer.alloc(files * record);
const both = Buffer.alloc(files * (record + numstat));
for (let index = 0; index < files; index++) {
  raw.write(header + path(index), index * record, 'latin1');
  both.write(header + path(index), index * record, 'latin1');
  both.write(`1\t1\t${path(index)}`, files * record + index * numstat, 'latin1');
}

const outcome = (read: () => unknown) => {
  try {
    read();
    return 'read';
  } catch (error) {
    return error instanceof GitError ? error.detail : String(error);
  }
};
parentPort?.postMessage([outcome(() => rawDiffBlobs(raw)), outcome(() => parseChanges(both))], []);
