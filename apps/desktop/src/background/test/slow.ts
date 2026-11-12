// A worker's entry that takes a second to load, longer than some jobs' deadlines, as the process's
// own script can on a busy machine.

import { work } from '../worker.ts';
import sampleRunner from './jobs.ts';

const loaded = Date.now() + 1000;
while (Date.now() < loaded) {
  // Loading.
}

void work([sampleRunner]);
