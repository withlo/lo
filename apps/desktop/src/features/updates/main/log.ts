// What electron-updater logs, in Lo's log, and why a check or a download failed, in words for the
// reader. Neither carries an address's query: GitHub sends a download on to its file host with an
// address whose query signs it, which nothing should keep. Nothing here calls Electron, so it runs
// under unit tests.

/** The most of one message Lo logs: a feed Lo can't read comes whole in electron-updater's error. */
const LOG_LIMIT = 2000;

/** `text` with every address's query and fragment taken out. */
export function withoutQueries(text: string): string {
  return text.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, '$1');
}

/** What a value electron-updater logs says: an error's stack, or the value as text. */
function said(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  return typeof value === 'string' ? value : String(value);
}

/** A message for Lo's log: without queries, and cut to {@link LOG_LIMIT} characters. */
export function logLine(value: unknown): string {
  const line = withoutQueries(said(value));
  return line.length > LOG_LIMIT ? `${line.slice(0, LOG_LIMIT)}… (cut)` : line;
}

/** electron-updater's logger, as its `logger` takes one. */
export interface UpdaterLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
}

/** A logger for electron-updater that writes to `log`. Its debugging lines are left out. */
export function updaterLogger(log: (line: string) => void): UpdaterLogger {
  return {
    info: (message) => log(logLine(message)),
    warn: (message) => log(logLine(message)),
    error: (message) => log(logLine(message)),
  };
}

/** The status GitHub answered with, as electron-updater's errors carry or say it. */
function statusOf(error: Error): number | undefined {
  if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
  const written = /\bHttpError: (\d{3})\b/.exec(error.message)?.[1];
  return written === undefined ? undefined : Number(written);
}

/** The code electron-updater gives an error, such as `ERR_UPDATER_INVALID_VERSION`. */
function codeOf(error: Error): string | undefined {
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

/** Why electron-updater failed, by the code it gives the error. */
const BY_CODE: Readonly<Record<string, string>> = {
  ERR_UPDATER_NO_PUBLISHED_VERSIONS: 'GitHub has no release of Lo yet.',
  ERR_UPDATER_CHANNEL_FILE_NOT_FOUND:
    'The newest release on GitHub has no download for this computer.',
  ERR_UPDATER_ZIP_FILE_NOT_FOUND: 'The newest release on GitHub has no download for this computer.',
  ERR_UPDATER_NO_FILES_PROVIDED: 'The newest release on GitHub has no download for this computer.',
  ERR_CHECKSUM_MISMATCH:
    'The download didn’t match the release’s checksum, so Lo deleted it. Try again.',
};

/**
 * Why a check for a newer Lo (`check`), or the download of one (`download`), failed, in a sentence
 * for the reader: what happened, and what to do when there's anything.
 */
export function reasonOf(error: unknown, during: 'check' | 'download'): string {
  if (!(error instanceof Error)) {
    return during === 'check'
      ? 'Lo couldn’t read the newest release on GitHub.'
      : 'The download stopped before it finished.';
  }
  const network = /\bnet::(ERR_[A-Z0-9_]+)/.exec(error.message)?.[1];
  if (network !== undefined) {
    return `Lo couldn’t reach GitHub (${network}). Check your connection, then try again.`;
  }
  const code = codeOf(error);
  const known = code === undefined ? undefined : BY_CODE[code];
  if (known !== undefined) return known;
  if (/code requirement|code ?sign|signature/i.test(error.message)) {
    return 'The update isn’t signed as this Lo is, so Lo won’t install it.';
  }
  const status = statusOf(error);
  if (status === 404 && code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND') {
    return 'GitHub has no release of Lo yet.';
  }
  if (status !== undefined) return `GitHub answered ${status}. Try again later.`;
  return during === 'check'
    ? 'Lo couldn’t read the newest release on GitHub.'
    : 'The download stopped before it finished. Try again.';
}
