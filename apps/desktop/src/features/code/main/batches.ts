// Files split into jobs for the background process, in the order given: each job has
// FILES_PER_JOB files and BYTES_PER_JOB bytes at most. No file is past FILE_BYTES, which is less
// than a job's bytes, so every file fits in a job of its own.

import { BYTES_PER_JOB, FILES_PER_JOB } from '../jobs.ts';

export function inJobs<T>(items: readonly T[], bytesOf: (item: T) => number): T[][] {
  const jobs: T[][] = [];
  let job: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = bytesOf(item);
    if (job.length > 0 && (job.length >= FILES_PER_JOB || bytes + size > BYTES_PER_JOB)) {
      jobs.push(job);
      job = [];
      bytes = 0;
    }
    job.push(item);
    bytes += size;
  }
  if (job.length > 0) jobs.push(job);
  return jobs;
}
