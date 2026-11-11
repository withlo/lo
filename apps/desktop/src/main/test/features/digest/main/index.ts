import { defineFeature } from '../../../../features.ts';
import { board } from '../../notes/service.ts';
import { contract } from '../contract.ts';

// It starts before notes, whose name comes after its own, and uses notes' service all the same.
export default defineFeature(contract, {
  handlers: {
    read: (_input, { use }) => ({ notes: use(board).count() }),
  },
  start({ publish, use }) {
    publish('started', { notes: use(board).count() });
  },
});
