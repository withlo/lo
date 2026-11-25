// The addresses features give `<img>` for images from GitHub: the window loads an image only from
// main, on the image scheme, never from its host. Main fetches each from GitHub's image hosts and
// serves it once it has checked it's an image.

import { avatarImageAddress, botImageAddress, postImageAddress } from '../ipc/images.ts';

/**
 * Where to load an image in a post from, in view `view` of a pull request's tab, whose account
 * main fetches it as: `address` is the image's own, as the post's tree gives it. Nothing for an
 * address that isn't on one of GitHub's image hosts, which shows as a link instead.
 */
export function postImage(view: string, address: string): string | undefined {
  return postImageAddress(view, address);
}

/**
 * An account, as GitHub names it: its login, and the type of account it is (`__typename`, as
 * `@lo/github`'s `ActorType` gives it).
 */
export interface Account {
  readonly login: string;
  readonly type: string;
}

/**
 * Where to load an account's avatar from, drawn `size` pixels a side: twice that, for screens with
 * two pixels to one. A person's or an organization's login names its avatar on GitHub; a bot's is
 * its app's picture, which main finds through GitHub. For a team or anything else, it's nothing, and
 * the avatar stays its initials, without asking.
 */
export function avatarImage(account: Account, size: number): string | undefined {
  const pixels = Math.ceil(size * 2);
  if (account.type === 'User' || account.type === 'Organization') {
    return avatarImageAddress(account.login, pixels);
  }
  if (account.type === 'Bot') return botImageAddress(account.login, pixels);
  return undefined;
}
