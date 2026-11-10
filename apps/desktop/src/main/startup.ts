/**
 * Why Lo can't start, in words for the person starting it. Main shows the message and quits;
 * anything else that stops startup is reported as it is.
 */
export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartupError';
  }
}
