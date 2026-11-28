/**
 * What the workflow's commands ask GitHub's REST API, with the workflow's token: a pull request's
 * repositories and whether it merged, and the account a commit's author maps to. Every answer is
 * read for only the fields used, each checked for its shape, so an answer of any other shape is a
 * failure, never a guess.
 */

/** GitHub couldn't be asked, or answered with a failure, and why, in words. */
export class GitHubError extends Error {
  override name = 'GitHubError';
}

/** A repository, by its id, which never changes, and its name, `owner/repo`. */
export interface Repository {
  id: number;
  name: string;
}

/** What the workflow needs of a pull request. */
export interface PullRequest {
  number: number;
  /** The repository it merges into. */
  base: Repository;
  /** The repository its branch is in: the base's, a fork, or undefined once the fork is deleted. */
  head: Repository | undefined;
  merged: boolean;
  /** When it merged, as GitHub writes a time: `2026-11-27T10:30:00Z`. */
  mergedAt: string | undefined;
}

/** What the workflow asks GitHub. */
export interface GitHub {
  /** The pull request `number` of `repo`, or undefined when there's none. */
  pull(repo: string, number: number): Promise<PullRequest | undefined>;
  /**
   * The login of the account GitHub maps the author of `repo`'s commit `id` to, or undefined when
   * it maps it to none, or has no such commit.
   */
  commitLogin(repo: string, id: string): Promise<string | undefined>;
}

/** A repository's name, `owner/repo`, as GitHub allows them. */
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** Whether `name` is a repository's name, `owner/repo`, and not one of the names git treats as paths. */
export function isRepositoryName(name: string): boolean {
  if (!REPOSITORY.test(name)) return false;
  const repo = name.slice(name.indexOf('/') + 1);
  return repo !== '.' && repo !== '..' && !repo.endsWith('.git');
}

/**
 * A GitHub login: letters, digits and hyphens, not starting with a hyphen, at most 39 in all, and
 * `[bot]` after an app's. The store holds no other.
 */
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/;

/** The most of an answer read: far more than either answer the workflow asks for holds. */
const ANSWER_LIMIT = 8 * 1024 * 1024;

/** How long one request may take, in milliseconds. */
const TIMEOUT = 30_000;

/**
 * GitHub's REST API at `api`, such as `https://api.github.com`, asked with `token`, through `fetch`.
 * A request that fails on the way, or that GitHub answers with a server error, is asked once more.
 */
export function gitHubApi(
  api: string,
  token: string,
  fetcher: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): GitHub {
  const base = api.replace(/\/+$/, '');

  /** The answer to `GET path`, or undefined for `404` and `422`. */
  const get = async (path: string): Promise<unknown> => {
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await pause(2_000);
      let response: Response;
      try {
        response = await fetcher(`${base}${path}`, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'withlo-overview',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT),
        });
      } catch (error) {
        failure = new GitHubError(`GitHub couldn't be reached: ${messageOf(error)}`);
        continue;
      }
      const text = await bounded(response);
      if (response.status === 404 || response.status === 422) return undefined;
      if (response.status >= 500) {
        failure = new GitHubError(`GitHub answered ${response.status}${said(text)}`);
        continue;
      }
      if (!response.ok) throw new GitHubError(`GitHub answered ${response.status}${said(text)}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new GitHubError("GitHub's answer isn't JSON.");
      }
    }
    throw failure;
  };

  return {
    async pull(repo, number) {
      const answer = await get(`/repos/${repoPath(repo)}/pulls/${number}`);
      if (answer === undefined) return undefined;
      return pullOf(answer, number);
    },
    async commitLogin(repo, id) {
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id))
        throw new GitHubError(`${id} isn't a commit.`);
      const answer = await get(`/repos/${repoPath(repo)}/commits/${id}`);
      if (!isRecord(answer)) return undefined;
      const author = answer['author'];
      if (!isRecord(author)) return undefined;
      const login = author['login'];
      return typeof login === 'string' && LOGIN.test(login) ? login : undefined;
    },
  };
}

/** `repo`, `owner/repo`, for a path. Throws for anything else, so nothing else reaches the URL. */
function repoPath(repo: string): string {
  if (!isRepositoryName(repo)) throw new GitHubError(`${JSON.stringify(repo)} isn't a repository.`);
  return repo;
}

/** The pull request in `answer`, which GitHub gave for `number`. Throws if it isn't one. */
function pullOf(answer: unknown, number: number): PullRequest {
  if (!isRecord(answer) || answer['number'] !== number) {
    throw new GitHubError(`GitHub's answer isn't pull request #${number}.`);
  }
  const base = isRecord(answer['base']) ? repositoryOf(answer['base']['repo']) : undefined;
  if (!base) throw new GitHubError(`GitHub's answer doesn't name #${number}'s base repository.`);
  const headRecord = isRecord(answer['head']) ? answer['head'] : undefined;
  // A deleted fork's pull request has no head repository.
  const head =
    headRecord && headRecord['repo'] !== null ? repositoryOf(headRecord['repo']) : undefined;
  if (headRecord && headRecord['repo'] !== null && !head) {
    throw new GitHubError(`GitHub's answer doesn't name #${number}'s head repository.`);
  }
  const merged = answer['merged'] === true;
  const at = answer['merged_at'];
  const mergedAt =
    typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(at)
      ? at
      : undefined;
  return { number, base, head, merged, mergedAt };
}

function repositoryOf(value: unknown): Repository | undefined {
  if (!isRecord(value)) return undefined;
  const id = value['id'];
  const name = value['full_name'];
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return undefined;
  if (typeof name !== 'string' || !isRepositoryName(name)) return undefined;
  return { id, name };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text of `response`, at most {@link ANSWER_LIMIT} bytes of it. Throws past it. */
async function bounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > ANSWER_LIMIT) {
      await reader.cancel();
      throw new GitHubError('GitHub answered with more than the workflow reads.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** GitHub's own message in `text`, its answer, as a sentence's end. */
function said(text: string): string {
  try {
    const answer: unknown = JSON.parse(text);
    if (isRecord(answer) && typeof answer['message'] === 'string') {
      return `: ${plain(answer['message'])}.`;
    }
  } catch {
    // Not JSON: nothing of it is said.
  }
  return '.';
}

/** `text` on one line, with nothing that moves or hides text, cut to a few dozen characters. */
export function plain(text: string): string {
  const flat = text.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]+/gu, ' ').trim();
  let kept = '';
  let count = 0;
  for (const char of flat) {
    if (count === 200) return `${kept}…`;
    kept += char;
    count += 1;
  }
  return kept;
}

function messageOf(error: unknown): string {
  return plain(error instanceof Error ? error.message : String(error));
}
