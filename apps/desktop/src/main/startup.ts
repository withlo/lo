/**
 * Why Lo can't start: this copy has no SQLite (`noSqlite`); its saved data is from a newer version
 * (`newerDatabase`, with the feature and migration that version added) or doesn't match this one
 * (`migrationChanged`, with the migration's file); or the cache folder can't be used
 * (`cacheFolder`, with why, its path and what the system said).
 */
export type StartupFailure =
  | { readonly kind: 'noSqlite' }
  | { readonly kind: 'newerDatabase'; readonly feature: string; readonly number: number }
  | { readonly kind: 'migrationChanged'; readonly feature: string; readonly file: string }
  | {
      readonly kind: 'cacheFolder';
      readonly why: 'noLocation' | 'missing' | 'link' | 'notFolder' | 'owner' | 'writable';
      readonly path?: string | undefined;
      readonly said?: string | undefined;
    };

/**
 * Why Lo can't start, as a kind with what words it. Its message is for the terminal, where a
 * developer reads it; the box the person sees is worded from `failure` ({@link startupWords}).
 * Anything else that stops startup is reported as it is.
 */
export class StartupError extends Error {
  readonly failure: StartupFailure;

  constructor(failure: StartupFailure, message: string) {
    super(message);
    this.name = 'StartupError';
    this.failure = failure;
  }
}

/** Why the cache folder can't be used, by `why`. */
const CACHE_WHY: Record<Extract<StartupFailure, { kind: 'cacheFolder' }>['why'], string> = {
  noLocation: 'macOS gave no location for it.',
  missing: 'It doesn’t exist.',
  link: 'It’s a link, not a folder.',
  notFolder: 'It isn’t a folder.',
  owner: 'Another user owns it.',
  writable: 'Other users can change it.',
};

/**
 * What the startup box says of `failure`: the fact and the one thing to do, then the detail, as the
 * box's last paragraph. The box is the system's, with no Details of Lo's.
 */
export function startupWords(failure: StartupFailure): { body: string; detail: string } {
  switch (failure.kind) {
    case 'noSqlite':
      return { body: 'This copy of Lo is incomplete. Download it again.', detail: 'node:sqlite' };
    case 'newerDatabase':
      return {
        body: 'Lo’s saved data is from a newer version. Update Lo to open it.',
        detail: `${failure.feature} ${String(failure.number).padStart(3, '0')}`,
      };
    case 'migrationChanged':
      return {
        body: 'Lo’s saved data doesn’t match this version.',
        detail: `${failure.feature}/${failure.file}`,
      };
    case 'cacheFolder':
      return {
        body: `The cache folder can’t be used. ${CACHE_WHY[failure.why]}`,
        detail: [failure.path, failure.said].filter((each) => each !== undefined).join('\n'),
      };
    default:
      throw new Error(
        `A startup failure Lo doesn’t know: ${JSON.stringify(failure satisfies never)}`,
      );
  }
}
