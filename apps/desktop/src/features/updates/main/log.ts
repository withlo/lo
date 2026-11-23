// What electron-updater logs, in Lo's log, and why a check or a download failed, as a kind the
// window words. Neither carries an address's query: GitHub sends a download on to its file host
// with an address whose query signs it, which nothing should keep. Nothing here calls Electron, so
// it runs under unit tests.

import type { Failure } from '../contract.ts';

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
const BY_CODE: Readonly<Record<string, Failure | 'noRelease'>> = {
  ERR_UPDATER_NO_PUBLISHED_VERSIONS: 'noRelease',
  ERR_UPDATER_CHANNEL_FILE_NOT_FOUND: 'noDownload',
  ERR_UPDATER_ZIP_FILE_NOT_FOUND: 'noDownload',
  ERR_UPDATER_NO_FILES_PROVIDED: 'noDownload',
  ERR_CHECKSUM_MISMATCH: 'damaged',
};

/**
 * Why a check for a newer Lo (`check`), or the download of one (`download`), failed, as a kind,
 * with what came with it for Details: the network's error or GitHub's status. `noRelease` is a
 * check that found no release at all, which is no failure: there's no update.
 */
export function failureOf(
  error: unknown,
  during: 'check' | 'download',
): { why: Failure | 'noRelease'; details?: string } {
  const otherwise = during === 'check' ? 'unknown' : 'stopped';
  if (!(error instanceof Error)) return { why: otherwise };
  const network = /\bnet::(ERR_[A-Z0-9_]+)/.exec(error.message)?.[1];
  if (network !== undefined) return { why: 'offline', details: network };
  const code = codeOf(error);
  const known = code === undefined ? undefined : BY_CODE[code];
  if (known !== undefined) return { why: known };
  if (/code requirement|code ?sign|signature/i.test(error.message)) return { why: 'unsigned' };
  const status = statusOf(error);
  if (status === 404 && code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND')
    return { why: 'noRelease' };
  if (status !== undefined) return { why: 'github', details: String(status) };
  return { why: otherwise };
}
