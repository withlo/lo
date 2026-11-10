import { IpcError } from '../../../../../ipc/contract.ts';
import type { Database } from '../../../../database.ts';
import { defineFeature } from '../../../../features.ts';
import { contract } from '../contract.ts';

const count = (database: Database) =>
  Number(database.prepare('SELECT count(*) AS count FROM notes_entries').get()?.count);

export default defineFeature(contract, {
  handlers: {
    add({ text }, { database, publish }) {
      const added = database.prepare('INSERT INTO notes_entries (text) VALUES (?)').run(text);
      publish('changed', count(database));
      return { id: Number(added.lastInsertRowid) };
    },
    remove({ id }, { database, publish }) {
      const removed = database.prepare('DELETE FROM notes_entries WHERE id = ?').run(id);
      if (!removed.changes) throw new IpcError('missing', `There's no note ${id}.`);
      publish('changed', count(database));
      return null;
    },
    count: (_input, { database }) => count(database),
    crash() {
      throw new Error('The secret token is hunter2.');
    },
  },
});
