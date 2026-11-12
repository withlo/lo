// What the code views need to know of the page: the nonce in its content security policy, which
// their style elements carry, and whether Lo runs as it ships, which keeps the smoke test's
// readings out of the page. Both come from `app.info`, once per page load.

import { useEffect, useState } from 'react';

import { client } from '../../../window/ipc.ts';
import { contract as app } from '../../app/contract.ts';

/** What `app.info` says of the page. */
export interface PageInfo {
  readonly nonce: string;
  readonly packaged: boolean;
}

let page: Promise<PageInfo> | undefined;

function pageInfo(): Promise<PageInfo> {
  page ??= client(app)
    .info()
    .then(({ nonce, packaged }) => ({ nonce, packaged }));
  return page;
}

/**
 * The page's nonce and whether Lo runs as it ships, once `app.info` has said. If it can't say, the
 * nonce is empty, so the views' styles are refused rather than let in some other way, and Lo is
 * taken to run as it ships.
 */
export function usePage(): PageInfo | undefined {
  const [found, setFound] = useState<PageInfo>();
  useEffect(() => {
    let live = true;
    pageInfo()
      .then((info) => {
        if (live) setFound(info);
      })
      .catch((error: unknown) => {
        console.error("Lo couldn't read the page's nonce:", error);
        if (live) setFound({ nonce: '', packaged: true });
      });
    return () => {
      live = false;
    };
  }, []);
  return found;
}
