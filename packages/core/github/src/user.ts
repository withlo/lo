/**
 * The scopes Lo asks for: `repo` to read, review and merge private repositories, `read:org` for
 * team review requests and code owners, and `workflow` because GitHub refuses to merge a pull
 * request that changes `.github/workflows` without it.
 */
export const SCOPES = ['repo', 'read:org', 'workflow'] as const;

export type Scope = (typeof SCOPES)[number];

/** A GitHub user, from `GET /user`. */
export interface User {
  login: string;
  id: number;
  name?: string | null;
  avatar_url?: string | null;
}

/** The user a token belongs to, and the scopes GitHub says it has. */
export interface AuthenticatedUser {
  user: User;
  scopes: string[];
}

/** Parses `x-oauth-scopes`, such as `read:org, repo, workflow`. */
export function parseScopes(header: string | null | undefined): string[] {
  return (header ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

/**
 * The scopes in {@link SCOPES} that `scopes` doesn't grant. A broader scope grants the narrower
 * one: `admin:org` and `write:org` include `read:org`.
 */
export function missingScopes(scopes: readonly string[]): Scope[] {
  const has = (scope: string) => scopes.includes(scope);
  return SCOPES.filter((needed) =>
    needed === 'read:org'
      ? !(has('read:org') || has('write:org') || has('admin:org'))
      : !has(needed),
  );
}
