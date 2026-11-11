import { formatVersion, type GitStatus } from '@lo/git';
import { app, nativeTheme } from 'electron';

import { defineFeature } from '../../../main/features.ts';
import { appInfo, contract, type GitInfo, type Theme } from '../contract.ts';

// Lo follows the system's appearance.
const currentTheme = (): Theme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

/** What the window hears of what Lo found of git. */
function gitInfo(status: GitStatus | undefined): GitInfo {
  if (status === undefined) return { status: 'checking' };
  if (status.status === 'found') {
    return { status: 'found', version: formatVersion(status.git.version) };
  }
  if (status.status === 'missing') {
    return { status: 'missing', message: status.message, install: status.install };
  }
  const { version, check, message, install } = status;
  return { status: 'tooOld', version: formatVersion(version), check, message, install };
}

export default defineFeature(contract, {
  handlers: {
    // Checked as a push is, so the window gets nothing but what the contract says.
    info: (_input, { git }) =>
      appInfo.parse({
        version: app.getVersion(),
        platform: process.platform,
        theme: currentTheme(),
        git: gitInfo(git.status),
      }),
  },
  start({ publish, git }) {
    nativeTheme.on('updated', () => publish('theme', currentTheme()));
    git.onStatus((status) => publish('git', gitInfo(status)));
  },
});
