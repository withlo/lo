/** The checker's entry point, as `npx` runs it. */

import { main } from './main.ts';

process.exitCode = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
