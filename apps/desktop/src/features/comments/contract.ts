// The comments feature's contract with main. The window loads the images in posts, and avatars,
// on the image scheme (`ipc/images.ts`), which the feature serves in main, so nothing of that goes
// through a request.

import { defineContract } from '../../ipc/contract.ts';

export const contract = defineContract('comments', { requests: {}, topics: {} });
