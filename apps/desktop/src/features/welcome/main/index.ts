import { defineFeature } from '../../../main/features.ts';
import { contract } from '../contract.ts';

export default defineFeature(contract, {
  handlers: {
    state(_input, { database }) {
      const row = database.prepare('SELECT at FROM welcome_finished WHERE id = 1').get();
      return { finished: row !== undefined };
    },
    finish(_input, { database }) {
      database
        .prepare('INSERT INTO welcome_finished (id, at) VALUES (1, ?) ON CONFLICT (id) DO NOTHING')
        .run(Date.now());
    },
    async checkGit(_input, { git }) {
      await git.check();
    },
  },
});
