// A server's downloads added up, so its status item counts them as one: the server, the Node it
// runs on and the toolchains it uses, "Java downloading · 38.1 MB of 177.4 MB". Its adapter names
// them up front, so the total holds from the first byte: each not installed yet counts its whole
// size from the start, and one installed already counts for nothing. One it didn't name counts
// once it starts. The item tells of the whole install as one: downloading until every byte has
// come, then unpacking, then building, never back, though each download is unpacked as it comes.
// Nothing here calls Electron.

import type { InstallProgress, InstallStage } from '@lo/lsp';

/** One download a server waits for: how much has come of how much, and what's being done with it. */
interface Part {
  received: number;
  total: number;
  stage: InstallStage;
  /** Whether it's installed, so nothing more is done with it. */
  installed: boolean;
}

/** What an install does, in the order it does it. */
const STAGES: readonly InstallStage[] = ['downloading', 'unpacking', 'building'];

export class DownloadSum {
  readonly #report: InstallProgress;
  readonly #parts = new Map<string, Part>();
  /** What was said last, so the same isn't said again. */
  #said: string | undefined;
  /** What's being done since every byte came: it goes on, never back, while none is to come. */
  #after: InstallStage | undefined;

  /**
   * Reports each change, as all of them added up, to `report`, with what's being done: downloading
   * while any byte is still to come, then the furthest any install not yet there has got.
   */
  constructor(report: InstallProgress) {
    this.#report = report;
  }

  /** Counts `key`, named up front and not installed yet, as `total` bytes still to come. */
  expect(key: string, total: number): void {
    if (!this.#parts.has(key)) {
      this.#parts.set(key, { received: 0, total, stage: 'downloading', installed: false });
    }
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
          this.#parts.set(key, { received, total, stage, installed: false });
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
        if (part === undefined) return;
        part.installed = true;
        part.received = part.total;
        this.#tell();
      },
    };
  }

  #tell(): void {
    let done = 0;
    let total = 0;
    for (const part of this.#parts.values()) {
      done += part.received;
      total += part.total;
    }
    let stage: InstallStage = 'downloading';
    if (done < total) {
      this.#after = undefined;
    } else {
      stage = this.#after ?? stage;
      for (const part of this.#parts.values()) {
        if (!part.installed && STAGES.indexOf(part.stage) > STAGES.indexOf(stage)) {
          stage = part.stage;
        }
      }
      this.#after = stage;
    }
    const said = `${done} ${total} ${stage}`;
    if (said === this.#said) return;
    this.#said = said;
    this.#report(done, total, stage);
  }
}
