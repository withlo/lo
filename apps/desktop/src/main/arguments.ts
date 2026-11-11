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
 * a web link or a file, passes Lo no arguments: links and files arrive as events. The `lo` command
 * passes its link as an argument, and refuses one that starts with `-`. What follows `--` counts
 * too. An unpackaged build, which `electron-vite dev` and the tests start with
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

/**
 * Variables in its environment that make Chromium or Node, whatever Lo does, write out what Lo
 * sends GitHub or stop checking who it's talking to, each with the value that does so, or any.
 * Lo uses none, and nothing a person's usual environment sets is among them.
 */
const refusedVariables: readonly { name: string; refuses: (value: string) => boolean }[] = [
  // Chromium writes every TLS connection's secrets to this file, which decrypts captured traffic,
  // tokens included.
  { name: 'SSLKEYLOGFILE', refuses: () => true },
  // Chromium's own logs, to the console or a file: what `--enable-logging` and `--log-file` do.
  { name: 'ELECTRON_ENABLE_LOGGING', refuses: () => true },
  { name: 'ELECTRON_LOG_FILE', refuses: () => true },
  // Node's TLS, which Lo's requests don't use, stops checking certificates.
  { name: 'NODE_TLS_REJECT_UNAUTHORIZED', refuses: (value) => value === '0' },
];

/**
 * The variables in `env` a packaged Lo refuses to start with, by name: the environment's way to
 * what the switches {@link refusedArguments} refuses do, such as `SSLKEYLOGFILE`, which has
 * Chromium write out the secrets of every connection to GitHub. An unpackaged build takes them
 * all. The certificate authorities' variables, which networks that inspect TLS need, aren't
 * refused.
 */
export function refusedEnvironment(options: {
  packaged: boolean;
  env: Readonly<Record<string, string | undefined>>;
}): string[] {
  if (!options.packaged) return [];
  return refusedVariables
    .filter(({ name, refuses }) => {
      const value = options.env[name];
      return value !== undefined && refuses(value);
    })
    .map(({ name }) => name);
}
