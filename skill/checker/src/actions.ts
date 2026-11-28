/**
 * Running in GitHub Actions: what the workflow's environment says, and the log its commands write,
 * where a line that needs a maintainer's eye is an annotation. The runner reads a line as one of
 * its commands when it starts with `::`, after any spaces, or holds `##[` anywhere, and a line may
 * quote a fork. So the log stops the runner's commands before its first line, with a token no one
 * else knows, and starts them again only to write an annotation, whose text is escaped as the
 * runner reads it. Each line is one line, so nothing quoted starts a line of its own.
 */

import { randomBytes } from 'node:crypto';

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

/** `given`, `name`'s value, when it's an HTTPS address with no name, password, query or hash. */
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

/** A log of the workflow's, which ends once its command has. */
export interface ActionsLog extends Log {
  /** Starts the runner's commands again, after the last line. */
  end(): void;
}

/**
 * A log writing to `out` as GitHub Actions reads it, with the runner's commands stopped but for its
 * annotations, each stopped again after with a new token from `token`.
 */
export function actionsLog(
  out: (text: string) => void,
  token: () => string = () => randomBytes(16).toString('hex'),
): ActionsLog {
  let stop = token();
  out(`::stop-commands::${stop}\n`);
  const annotate = (kind: 'warning' | 'error', text: string) => {
    out(`::${stop}::\n::${kind}::${escaped(text)}\n`);
    stop = token();
    out(`::stop-commands::${stop}\n`);
  };
  return {
    info: (text) => out(`${oneLine(text)}\n`),
    warning: (text) => annotate('warning', text),
    error: (text) => annotate('error', text),
    end: () => out(`::${stop}::\n`),
  };
}

/** `text` on one line. */
function oneLine(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, ' ');
}

/** `text` as an annotation's message, escaped as the runner reads it. */
function escaped(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}
