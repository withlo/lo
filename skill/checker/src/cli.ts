/** The checker's entry point, as `npx` runs it. */

import { main } from './main.ts';

try {
  process.exitCode = await main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
} catch {
  // Writing failed too: it still can't check, which exits 2, never 1 as if the overview had errors.
  process.exitCode = 2;
}
