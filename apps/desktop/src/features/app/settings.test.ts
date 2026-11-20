import { expect, it } from 'vitest';

import { gpu } from './settings.ts';

it('has app.gpu on by default, and only the person editing the file changes it', () => {
  expect(gpu).toMatchObject({ key: 'app.gpu', fallback: true, window: 'read' });
  expect(gpu.schema.safeParse(false).success).toBe(true);
  expect(gpu.schema.safeParse('false').success).toBe(false);
});
