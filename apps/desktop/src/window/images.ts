// The addresses features give `<img>` for images from GitHub: the window loads an image only from
// main, on the image scheme, never from its host. Main fetches each from GitHub's image hosts and
// serves it once it has checked it's an image.

import { avatarImageAddress, postImageAddress } from '../ipc/images.ts';

/**
 * Where to load an image in a post from, in view `view` of a pull request's tab, whose account
 * main fetches it as: `address` is the image's own, as the post's tree gives it. Nothing for an
 * address that isn't on one of GitHub's image hosts, which shows as a link instead.
 */
export function postImage(view: string, address: string): string | undefined {
  return postImageAddress(view, address);
}

/** An account, as GitHub names it: its login, and the type of account it is (`__typename`). */
export interface Account {
  readonly login: string;
  readonly type: string;
}

/**
 * Where to load an account's avatar from, drawn `size` pixels a side: twice that, for screens with
 * two pixels to one. Only a person's or an organization's login names its avatar on GitHub; for a
 * bot, a team or anything else, it's nothing, and the avatar stays its initials, without asking.
 */
export function avatarImage(account: Account, size: number): string | undefined {
  if (account.type !== 'User' && account.type !== 'Organization') return undefined;
  return avatarImageAddress(account.login, Math.ceil(size * 2));
}
