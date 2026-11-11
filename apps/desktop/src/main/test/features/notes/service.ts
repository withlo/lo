import { defineService } from '../../../services.ts';

/** What the notes feature offers other features. */
export interface Board {
  /** How many notes there are. */
  count(): number;
}

export const board = defineService<Board>('notes.board');
