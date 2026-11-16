import { defineConfig } from '@playwright/test';

import suite from './playwright.config.ts';

// A run of Lo on GitHub itself, by hand: `nx run desktop:live`, which builds the app first. Its specs
// are `*.live.ts`, which the suite's config never runs, and each starts Lo live (`live` in app.ts).
// One at a time: every copy keeps its data in the one folder `LO_USER_DATA_DIR` names, and Lo quits
// a second copy started on a folder another holds.
export default defineConfig<{ live: boolean }>({
  ...suite,
  testMatch: '**/*.live.ts',
  fullyParallel: false,
  workers: 1,
  // A spec on GitHub itself changes what's there, so a failed one isn't tried again.
  retries: 0,
  use: { ...suite.use, live: true },
});
