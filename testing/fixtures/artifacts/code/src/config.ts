/** How the limiter behaves, from the environment. */
export interface Config {
  /** How long a request waits for a token before it fails, in milliseconds. */
  timeout: number;
}

export const config: Config = {
  timeout: 5_000,
};
