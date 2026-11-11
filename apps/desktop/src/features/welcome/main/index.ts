import { defineFeature } from '../../../main/features.ts';
import { contract } from '../contract.ts';

export default defineFeature(contract, {
  handlers: {
    async checkGit(_input, { git }) {
      await git.check();
    },
  },
});
