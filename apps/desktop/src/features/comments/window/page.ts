// The nonce in the page's content security policy, which the style elements of a comment box drawn
// outside the code views carry, as the timeline's are, from `app.info`, once per page load.

import { useEffect, useState } from 'react';

import { client } from '../../../window/ipc.ts';
import { contract as app } from '../../app/contract.ts';

let asked: Promise<string> | undefined;

/**
 * The page's nonce, once `app.info` has said. If it can't say, it's empty, so the editor's styles
 * are refused rather than let in some other way.
 */
export function useNonce(): string | undefined {
  const [nonce, setNonce] = useState<string>();
  useEffect(() => {
    let live = true;
    asked ??= client(app)
      .info()
      .then((info) => info.nonce)
      .catch((error: unknown) => {
        console.error("Lo couldn't read the page's nonce:", error);
        return '';
      });
    void asked.then((found) => {
      if (live) setNonce(found);
    });
    return () => {
      live = false;
    };
  }, []);
  return nonce;
}
