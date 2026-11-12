/**
 * Which web addresses the renderer lets a reader follow. The tree keeps `http:` and `https:` pages,
 * but the window hands main only `https://` ones: main can't tell a link the reader chose from one
 * a page made up, and a plain `http://` page can be changed on its way. Main checks again.
 */

import { webLink } from '@lo/markdown';

/** `url` when it's an `https://` page Lo may open, as `webLink` normalizes it; else undefined. */
export function secureLink(url: string): string | undefined {
  const link = webLink(url);
  return link !== undefined && link.startsWith('https://') ? link : undefined;
}
