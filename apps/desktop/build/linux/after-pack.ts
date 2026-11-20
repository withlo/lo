// electron-builder's afterPack hook for a release (build/release.yml), run once Lo is laid out in
// its folder and before that folder is packaged. On Linux it makes Chromium's sandbox helper
// setuid there, so the deb and the rpm, whose files root owns, hold it setuid root. It changes
// nothing on the Mac.
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';

import type { AfterPackContext } from 'electron-builder';

export default async function afterPack(context: AfterPackContext): Promise<void> {
  if (context.electronPlatformName !== 'linux') return;
  await chmod(join(context.appOutDir, 'chrome-sandbox'), 0o4755);
}
