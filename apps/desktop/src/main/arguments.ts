/**
 * Switches that are also looked for by name, in case one reaches Chromium without being one of
 * `process.argv`'s arguments. Each hands whoever passes it a way into the window or Lo's traffic.
 */
const named = [
  'remote-debugging-port',
  'remote-debugging-pipe',
  'ignore-certificate-errors',
  'host-resolver-rules',
  'proxy-server',
  'js-flags',
] as const;

/**
 * The command-line switches a packaged Lo refuses to start with, as `--name`, or none. Chromium
 * takes switches that Lo has no use for and that can turn it against its person: one opens a port
 * that drives every request the window may make, and others send main's requests, with their
 * `Authorization` header, to a server of the sender's choosing and accept its certificate. So a
 * packaged Lo takes none: any argument that starts with `-` is refused, in either form and
 * whatever it says, since new switches come with every Chromium.
 *
 * Nothing is let through. A launch from Finder, the Dock or `open`, with or without a `lo://` link,
 * a web link or a file, passes Lo no arguments: links and files arrive as events. What follows
 * `--` counts too. An unpackaged build, which `electron-vite dev` and the tests start with
 * switches, takes them all.
 */
export function refusedArguments(options: {
  packaged: boolean;
  /** The arguments after the executable's, as `process.argv` has them. */
  argv: readonly string[];
  /** Whether Chromium found a switch with this name, as `app.commandLine.hasSwitch` says. */
  hasSwitch: (name: string) => boolean;
}): string[] {
  if (!options.packaged) return [];
  const refused = options.argv
    .filter((argument) => argument.startsWith('-'))
    .map((argument) => argument.split('=')[0] ?? argument);
  for (const name of named) {
    if (options.hasSwitch(name) && !refused.some((found) => found.replace(/^-+/, '') === name)) {
      refused.push(`--${name}`);
    }
  }
  return refused;
}
