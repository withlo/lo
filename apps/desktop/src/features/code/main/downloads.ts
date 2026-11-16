// A server's downloads added up, so its status item counts them as one: the server, the Node it
// runs on and the toolchains it uses, "Java downloading · 38.1 MB of 177.4 MB". Its adapter names
// them up front, so the total holds from the first byte: each not installed yet counts its whole
// size from the start, and one installed already counts for nothing. One it didn't name counts
// once it starts. While one that has come is unpacked, or built, the item says so. Nothing here
// calls Electron.

import type { InstallProgress, InstallStage } from '@lo/lsp';

/** One download a server waits for: how much has come of how much, and what's being done with it. */
interface Part {
  received: number;
  total: number;
  stage: InstallStage;
}

export class DownloadSum {
  readonly #report: InstallProgress;
  readonly #parts = new Map<string, Part>();

  /**
   * Reports each change, as all of them added up, to `report`, with what's being done: a build or
   * an unpacking under way, else downloading.
   */
  constructor(report: InstallProgress) {
    this.#report = report;
  }

  /** Counts `key`, named up front and not installed yet, as `total` bytes still to come. */
  expect(key: string, total: number): void {
    if (!this.#parts.has(key)) this.#parts.set(key, { received: 0, total, stage: 'downloading' });
  }

  /**
   * What hears `key`'s download's progress, as `@lo/lsp`'s `Installer` reports it, and `done`, for
   * once the install is there, whether or not it had to download.
   */
  part(key: string): { progress: InstallProgress; done: () => void } {
    return {
      progress: (received, total, stage) => {
        const part = this.#parts.get(key);
        if (part === undefined) {
          this.#parts.set(key, { received, total, stage });
        } else {
          part.received = received;
          part.total = total;
          part.stage = stage;
        }
        this.#tell();
      },
      done: () => {
        const part = this.#parts.get(key);
        // An install that had nothing to download says nothing.
        if (part === undefined || (part.received === part.total && part.stage === 'downloading')) {
          return;
        }
        part.received = part.total;
        part.stage = 'downloading';
        this.#tell();
      },
    };
  }

  #tell(): void {
    let done = 0;
    let total = 0;
    let stage: InstallStage = 'downloading';
    for (const part of this.#parts.values()) {
      done += part.received;
      total += part.total;
      if (part.stage === 'building' || (part.stage === 'unpacking' && stage === 'downloading')) {
        stage = part.stage;
      }
    }
    this.#report(done, total, stage);
  }
}
