/**
 * Running in GitHub Actions: what the workflow's environment says, and the log its commands write,
 * where a line that needs a maintainer's eye is an annotation. Each line is one line: what it
 * quotes, from a fork or anywhere else, can't start a line of its own, so it can't be read as one of
 * the runner's commands.
 */

import { isRepositoryName } from './github.ts';

/** The workflow's environment couldn't be read, and why, in words. */
export class ContextError extends Error {
  override name = 'ContextError';
}

/** Where the workflow runs, and its token. */
export interface ActionsContext {
  /** The repository it runs in, `owner/repo`. */
  repository: string;
  /** GitHub's address, such as `https://github.com`, with no path. */
  server: string;
  /** GitHub's REST API's address, such as `https://api.github.com`. */
  api: string;
  /** The workflow's token, `GITHUB_TOKEN`. */
  token: string;
}

/**
 * The context in `env`, as GitHub Actions sets it, and `GITHUB_TOKEN`, which the workflow passes.
 * Throws when any of it is missing or isn't what Actions sets.
 */
export function actionsContext(env: NodeJS.ProcessEnv): ActionsContext {
  const repository = env['GITHUB_REPOSITORY'];
  if (repository === undefined || !isRepositoryName(repository)) {
    throw new ContextError(
      'GITHUB_REPOSITORY names no repository. keep and fold run in the repository’s workflow.',
    );
  }
  const server = address(env['GITHUB_SERVER_URL'] ?? 'https://github.com', 'GITHUB_SERVER_URL');
  if (new URL(server).pathname !== '/') {
    throw new ContextError(
      'GITHUB_SERVER_URL is an address with no path, such as https://github.com.',
    );
  }
  const api = address(env['GITHUB_API_URL'] ?? 'https://api.github.com', 'GITHUB_API_URL');
  const token = env['GITHUB_TOKEN'];
  if (token === undefined || token === '' || /\s/.test(token)) {
    throw new ContextError('GITHUB_TOKEN is empty. The workflow passes it the token.');
  }
  return { repository, server: server.replace(/\/$/, ''), api: api.replace(/\/$/, ''), token };
}

/** `given`, `name`'s value, when it's an HTTPS address with no name, password, query or fragment. */
function address(given: string, name: string): string {
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    throw new ContextError(`${name} isn't an address.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ContextError(`${name} is an HTTPS address, such as https://github.com.`);
  }
  return url.href;
}

/** The address git fetches the repository `name`, `owner/repo`, from on `server`. */
export function repositoryUrl(server: string, name: string): string {
  return `${server}/${name}.git`;
}

/** What the workflow's commands say. */
export interface Log {
  /** A line saying what was done, or why nothing was. */
  info(text: string): void;
  /** A line for a maintainer to look at, such as a copy left as it was: a warning annotation. */
  warning(text: string): void;
  /** A line saying what failed: an error annotation. */
  error(text: string): void;
}

/** A log writing to `out` as GitHub Actions reads it. */
export function actionsLog(out: (text: string) => void): Log {
  return {
    info: (text) => out(`${oneLine(text)}\n`),
    warning: (text) => out(`::warning::${escaped(text)}\n`),
    error: (text) => out(`::error::${escaped(text)}\n`),
  };
}

/** `text` on one line, never starting as one of the runner's commands, `::`. */
function oneLine(text: string): string {
  const line = text.replace(/[\r\n\u2028\u2029]+/g, ' ');
  return line.startsWith('::') ? ` ${line}` : line;
}

/** `text` as an annotation's message, escaped as the runner reads it. */
function escaped(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}
