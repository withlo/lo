import { IpcError } from '../../../../../ipc/contract.ts';
import { defineFeature, type FeatureContext } from '../../../../features.ts';
import { contract } from '../contract.ts';

const notes = new Map<number, string>();
let context: FeatureContext<typeof contract> | undefined;

export default defineFeature(contract, {
  handlers: {
    add({ text }) {
      const id = notes.size + 1;
      notes.set(id, text);
      context?.publish('changed', notes.size);
      return { id };
    },
    remove({ id }) {
      if (!notes.delete(id)) throw new IpcError('missing', `There's no note ${id}.`);
      context?.publish('changed', notes.size);
      return null;
    },
    count: () => notes.size,
    crash() {
      throw new Error('The secret token is hunter2.');
    },
  },
  start(started) {
    context = started;
  },
});
