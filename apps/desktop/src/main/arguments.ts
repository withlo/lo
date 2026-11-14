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
  'ssl-key-log-file',
  'log-net-log',
] as const;

/**
 * An argument a packaged Lo starts with: a link, `lo://`, `https://` or `http://`, from its very
 * first character. Chromium trims whitespace from each argument before it looks for a switch, so
 * ` --ssl-key-log-file=…` is a switch to it; an argument that starts with a link's scheme never is.
 */
const LINK = /^(?:lo|https?):\/\//i;

/**
 * The command-line arguments a packaged Lo refuses to start with, or none: every argument but a
 * link, each named by what comes before any `=`, so a value is never repeated. Chromium takes
 * switches that Lo has no use for and that can turn it against its person: one opens a port that
 * drives every request the window may make, others send main's requests, with their
 * `Authorization` header, to a server of the sender's choosing and accept its certificate, or
 * write out the secrets of every connection. Chromium reads an argument as a switch once it has
 * trimmed the whitespace around it, and new switches come with every Chromium, so rather than look
 * for switches, a packaged Lo takes links alone.
 *
 * Nothing else is let through. A launch from Finder, the Dock or `open`, with or without a `lo://`
 * link, a web link or a file, passes Lo no arguments: links and files arrive as events. The `lo`
 * command passes its link as an argument, and refuses anything else. What follows `--` counts too.
 * An unpackaged build, which `electron-vite dev` and the tests start with switches, takes them all.
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
    .filter((argument) => !LINK.test(argument))
    .map((argument) => argument.split('=', 1)[0] ?? argument);
  for (const name of named) {
    const shown = refused.some((found) => found.trim().replace(/^-+/, '') === name);
    if (options.hasSwitch(name) && !shown) refused.push(`--${name}`);
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
  // Node's TLS, which Lo's writes to GitHub go over, stops checking certificates for any request that
  // doesn't ask for the check itself, as Lo's writes do.
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
