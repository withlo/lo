import { expect, it } from 'vitest';

import { gpu } from './settings.ts';

// That app.gpu is on with no file, and what its key turns off, is `main/gpu.test.ts`'s, which reads
// the file as main does before `ready`.
it('has only the person editing the file change app.gpu, to true or false', () => {
  expect(gpu.window).toBe('read');
  expect(gpu.schema.safeParse(false).success).toBe(true);
  expect(gpu.schema.safeParse('false').success).toBe(false);
});
