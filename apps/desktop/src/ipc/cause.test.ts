import { describe, expect, it } from 'vitest';

import { DETAILS_LIMIT, detailsOf } from './cause.ts';

describe('detailsOf', () => {
  it('carries what the source said without what turns text around, trimmed and cut', () => {
    expect(detailsOf(undefined)).toBeUndefined();
    expect(detailsOf('  \n')).toBeUndefined();
    // An override and an isolate go; the marks that only place a neighbour stay.
    expect(detailsOf(' Not Found ‮gnp.exe‬⁦x⁩ ‏')).toBe('Not Found gnp.exex ‏');
    expect(detailsOf('‮')).toBeUndefined();
    const long = detailsOf('a'.repeat(DETAILS_LIMIT + 10));
    expect(long).toHaveLength(DETAILS_LIMIT);
    expect(long?.endsWith('…')).toBe(true);
  });
});
