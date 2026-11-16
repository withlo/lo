/**
 * What a server is given that depends on where it runs: its checkout and its home, each as the
 * system resolves it, once its home is made and just before it starts. Most servers need none of
 * this. SourceKit-LSP does: it writes its generated files and its module cache where its options
 * say, never in `HOME` or `TMPDIR`, so its options name folders in its home, and Apple's Foundation
 * takes the home folder from `CFFIXED_USER_HOME` rather than `HOME`.
 */

/** Where a server runs, each folder as the system resolves it. */
export interface Where {
  /** The checkout it runs on. */
  readonly root: string;
  /** Its own folder, its `HOME`, made already. */
  readonly home: string;
}

/** What a server is given that depends on where it runs. */
export interface Placed {
  /** More variables of its own, such as one that names its home. */
  readonly variables?: Readonly<Record<string, string>> | undefined;
  /** Its `initializationOptions`, in place of what its spec says. */
  readonly initializationOptions?: unknown;
}

/** Works out what a server is given where it runs. */
export type Place = (where: Where) => Promise<Placed>;
