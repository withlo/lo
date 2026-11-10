// A worker's entry for the tests, as the background process's own script is in the app.

import { work } from '../worker.ts';
import sampleRunner from './jobs.ts';

void work([sampleRunner]);
