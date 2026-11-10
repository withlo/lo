// Jobs wait their turn for a worker, so however many arrive at once, no more run than the machine
// has cores, and each one's deadline starts when it does.

import type { Result } from '../ipc/contract.ts';
import type { Execute } from './host.ts';

export function pool(execute: Execute, size: number, waitingLimit = 1000): Execute {
  let running = 0;
  const waiting: (() => void)[] = [];

  const next = () => {
    running -= 1;
    waiting.shift()?.();
  };

  return (job, input, limits) => {
    if (running >= size && waiting.length >= waitingLimit) {
      return Promise.resolve({
        ok: false,
        error: { code: 'busy', message: 'Too many jobs are waiting; try again later.' },
      });
    }
    return new Promise<Result<unknown>>((resolve) => {
      const start = () => {
        running += 1;
        void execute(job, input, limits)
          .catch((): Result<unknown> => ({
            ok: false,
            error: { code: 'failed', message: `${job} failed.` },
          }))
          .then(resolve)
          .finally(next);
      };
      if (running < size) start();
      else waiting.push(start);
    });
  };
}
