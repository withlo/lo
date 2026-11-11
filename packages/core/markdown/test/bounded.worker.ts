// Reads GitHub's rendering of a made-up post in a thread whose heap is capped as a background job's
// is, and says how long it took and what it made.

import { parentPort, workerData } from 'node:worker_threads';

import { githubTree } from '../src/index.ts';

const html = String(workerData);
const started = performance.now();
const tree = githubTree({ html, markdown: 'fallback' });
parentPort?.postMessage({ elapsed: performance.now() - started, tree }, []);
