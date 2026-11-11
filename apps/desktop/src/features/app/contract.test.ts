import { describe, expect, it } from 'vitest';

import { appInfo } from './contract.ts';

describe('appInfo', () => {
  const info = {
    version: '0.0.0',
    platform: 'darwin',
    theme: 'dark',
    git: { status: 'found', version: '2.54.0' },
  };

  it('takes what app.info answers, whatever Lo found of git', () => {
    expect(appInfo.parse(info)).toEqual(info);
    for (const git of [
      { status: 'checking' },
      { status: 'missing', message: "Lo can't find git.", install: 'Install git.' },
      {
        status: 'tooOld',
        version: '2.30.0',
        check: 'version',
        message: 'Lo needs git 2.41.0 or newer.',
        install: 'Install git.',
      },
    ]) {
      expect(appInfo.parse({ ...info, git })).toEqual({ ...info, git });
    }
  });

  it('refuses anything the contract doesn’t name', () => {
    for (const wrong of [
      { ...info, token: 'hunter2' },
      { ...info, theme: 'sepia' },
      { ...info, git: { status: 'found', version: '2.54.0', program: '/usr/bin/git' } },
      { ...info, git: { status: 'lost' } },
      {
        ...info,
        git: { status: 'tooOld', version: '2.30.0', check: 'colour', message: '', install: '' },
      },
    ]) {
      expect(appInfo.safeParse(wrong).success).toBe(false);
    }
  });
});
