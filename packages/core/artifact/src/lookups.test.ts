import { expect, test, vi } from 'vitest';

import { listed, overviewFiles, repository } from '../test/readers.ts';
import { overview } from '../test/support.ts';
import { caseIndex } from './commit.ts';
import { checkArtifact, LIMITS, parseArtifact } from './index.ts';

vi.mock(import('./commit.ts'), async (original) => {
  const commit = await original();
  return { ...commit, caseIndex: vi.fn<typeof commit.caseIndex>(commit.caseIndex) };
});

test('paths in another case are indexed once, however many figures are missing', async () => {
  const blocks = Array.from(
    { length: LIMITS.figures },
    (_, n) => `:::figure figures/f${n}.png\nF.\n:::`,
  );
  const text = overview(`${blocks.join('\n')}\n`);
  const entries = Array.from({ length: 400 }, (_, n) => listed(`figures/F${n}.png`, 'file', 1));
  const files = overviewFiles({ 'artifact.md': text }, entries);
  const checked = await checkArtifact(parseArtifact(text), files, repository('', {}).readCode);
  expect(checked.findings.filter(({ code }) => code === 'figure-missing')).toHaveLength(
    LIMITS.figures,
  );
  expect(checked.findings[0]?.message).toContain('It has figures/F0.png');
  expect(vi.mocked(caseIndex)).toHaveBeenCalledTimes(1);
});
