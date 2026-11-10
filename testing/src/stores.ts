/** In-memory stand-ins for what the app keeps on disk, which a test can tell to fail. */

/** An answer kept with its ETag. */
export interface KeptAnswer {
  etag: string;
  body: string;
}

/** A client's store of ETags and answers, kept in memory. */
export class MemoryStore {
  readonly answers = new Map<string, KeptAnswer>();
  /** When set, every read and write fails, as a store that can't be opened does. */
  failing = false;

  get(url: string): Promise<KeptAnswer | undefined> {
    if (this.failing) return Promise.reject(new Error('the store refused the read'));
    return Promise.resolve(this.answers.get(url));
  }

  set(url: string, answer: KeptAnswer): Promise<void> {
    if (this.failing) return Promise.reject(new Error('the store refused the write'));
    this.answers.set(url, { ...answer });
    return Promise.resolve();
  }

  delete(url: string): Promise<void> {
    if (this.failing) return Promise.reject(new Error('the store refused the delete'));
    this.answers.delete(url);
    return Promise.resolve();
  }
}
