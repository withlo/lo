// What the overview's code views need to know of the page: the nonce in its content security
// policy, which their style elements carry. It comes from `app.info`, once per page load.

import { useEffect, useState } from 'react';

import { client } from '../../../window/ipc.ts';
import { contract as app } from '../../app/contract.ts';

/** What `app.info` says of the page. */
export interface PageInfo {
  readonly nonce: string;
}

let page: Promise<PageInfo> | undefined;

function pageInfo(): Promise<PageInfo> {
  page ??= client(app)
    .info()
    .then(({ nonce }) => ({ nonce }));
  return page;
}

/**
 * The page's nonce, once `app.info` has said. If it can't say, the nonce is empty, so the views'
 * styles are refused rather than let in some other way.
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
        if (live) setFound({ nonce: '' });
      });
    return () => {
      live = false;
    };
  }, []);
  return found;
}
