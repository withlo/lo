/**
 * What the fake language server does, read from a scenario file, and what it reports having seen.
 */

/** A request or notification the fake server sends Lo once it's initialized. */
export interface Outgoing {
  readonly method: string;
  readonly params?: unknown;
  /** How long to wait before sending it, in milliseconds. */
  readonly delay?: number;
}

export interface Scenario {
  /** Where it reports what it saw, one JSON object per line. */
  readonly report: string;
  /** How it answers `initialize`: its result, after a delay, or never. */
  readonly initialize?: {
    readonly result?: unknown;
    readonly delay?: number;
    readonly hang?: boolean;
  };
  /**
   * Its answer to each method, by the path of the file asked about (the end of its URI), or by `*`
   * for any file. A method with no answer here answers `null`.
   */
  readonly answers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** How long it takes to answer each method, in milliseconds. */
  readonly delays?: Readonly<Record<string, number>>;
  /** It exits with `code` as the `requests`th request after `initialize` arrives, unanswered. */
  readonly crash?: { readonly requests: number; readonly code: number };
  /** It never answers a request after `initialize`. */
  readonly hang?: boolean;
  /** Memory it fills once initialized, in megabytes. */
  readonly memory?: number;
  /** Requests it sends Lo once initialized, one after another; it reports each reply. */
  readonly requests?: readonly Outgoing[];
  /** Notifications it sends Lo after those requests. */
  readonly notifications?: readonly Outgoing[];
  /** It starts a process of its own once initialized, which runs until it's killed. */
  readonly child?: boolean;
  /** It starts a process in a session of its own once initialized, out of its group. */
  readonly escapee?: boolean;
  /**
   * Its escapee starts a sleeper in a session of its own every few milliseconds, reporting each,
   * until it's stopped.
   */
  readonly sleepers?: boolean;
  /** It ignores `shutdown`, `exit` and `SIGTERM`. */
  readonly stubborn?: boolean;
  /** Lines it writes to stderr as it starts. */
  readonly stderr?: readonly string[];
  /**
   * It writes `header` to stdout, then `frame` (64 KiB of `x` unless it says) again and again until
   * it's killed: once initialized; once asked to shut down, in place of its answer; or once it has
   * answered `shutdown`. One that floods at shutdown ignores `exit` and `SIGTERM`. With `stderr`,
   * it writes `frame` to stderr just as fast, and with `stderr: 'only'`, to stderr alone.
   */
  readonly flood?: {
    readonly at: 'initialized' | 'shutdown' | 'afterShutdown';
    readonly header: string;
    readonly frame?: string;
    readonly stderr?: boolean | 'only';
  };
}

/** What the fake server reports, in the order it saw it. */
export type Seen =
  | {
      readonly event: 'started';
      readonly pid: number;
      /** The program it was started as, as given to it. */
      readonly argv0: string;
      readonly env: Record<string, string>;
      readonly cwd: string;
    }
  | { readonly event: 'initialize'; readonly params: Record<string, unknown> }
  | { readonly event: 'initialized' }
  | { readonly event: 'opened'; readonly uri: string; readonly text: string }
  | { readonly event: 'closed'; readonly uri: string }
  | { readonly event: 'request'; readonly method: string; readonly params: unknown }
  | { readonly event: 'cancelled'; readonly method: string }
  | {
      readonly event: 'reply';
      readonly method: string;
      readonly result?: unknown;
      readonly error?: { readonly code: number; readonly message: string };
    }
  | { readonly event: 'notification'; readonly method: string; readonly params: unknown }
  | { readonly event: 'child'; readonly pid: number }
  | { readonly event: 'escapee'; readonly pid: number }
  /** A sleeper its escapee started. */
  | { readonly event: 'sleeper'; readonly pid: number }
  | { readonly event: 'shutdown' }
  | { readonly event: 'exit' };
