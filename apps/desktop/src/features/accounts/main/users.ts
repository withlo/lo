// Who a new token belongs to, as GitHub said, checked before Lo keeps an account for it.

import { GithubError, type AuthenticatedUser } from '@lo/github';

/** A login as GitHub allows them. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * `user`, once its login is one GitHub allows and its id a positive whole number, with a name that's
 * text or nothing. GitHub's answer to `GET /user` isn't otherwise checked, and Lo keeps the account
 * under this login. Throws a `decode` {@link GithubError} otherwise.
 */
export function checkedUser(user: AuthenticatedUser): AuthenticatedUser {
  const { login, id, name } = user.user;
  if (typeof login !== 'string' || !LOGIN.test(login)) {
    throw new GithubError({ kind: 'decode', message: "GitHub's answer named no login Lo can use" });
  }
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new GithubError({ kind: 'decode', message: "GitHub's answer named no account id" });
  }
  return {
    user: { ...user.user, name: typeof name === 'string' ? name.slice(0, 255) : null },
    scopes: user.scopes,
  };
}
