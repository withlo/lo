// In a build run from source, the page offers its smoke test a way to mount a code view on its own
// and look at it in the window as it runs: under the window's content security policy, with the
// nonce `app.info` hands the page. The views load when one is first mounted, so a packaged Lo,
// which never offers this, never loads them for it.

import type { DiffView, FileView } from '@lo/ui/code';

import { registry } from '../../../window/commands/registry.ts';

/** A code view to mount: a diff of two files, or one whole file. */
type Kind = 'diff' | 'file';

/** What a mounted view told its caller, in order. */
type Heard = { event: string; args: unknown[] }[];

interface CodeViews {
  /** Mounts a code view over the window, in place of one mounted before, and focuses it. */
  mount(kind: Kind): Promise<void>;
  /** Takes the mounted view away. */
  unmount(): void;
  /** What the mounted view has told its caller since it was mounted. */
  readonly heard: Heard;
}

declare global {
  interface Window {
    /** Code views on their own, for the smoke test, in a build run from source. */
    loCodeViews?: CodeViews;
  }
}

const before = ["import { serve } from './server';", '', 'export function start(): void {'];
const code = [...before, '  serve({ port: 8080 });', '}'];

/** Offers `window.loCodeViews`, whose views carry `nonce`. */
export function offerCodeViews(nonce: string): void {
  let mounted: { view: DiffView | FileView; box: HTMLElement } | undefined;
  const heard: Heard = [];
  const hear =
    (event: string) =>
    (...args: unknown[]): void => {
      heard.push({ event, args });
    };
  const unmount = (): void => {
    mounted?.view.destroy();
    mounted?.box.remove();
    mounted = undefined;
    heard.length = 0;
  };
  window.loCodeViews = {
    heard,
    async mount(kind) {
      const [{ createDiffView, createFileView }] = await Promise.all([
        import('@lo/ui/code'),
        import('@lo/ui/code/view.css'),
      ]);
      unmount();
      const box = document.createElement('div');
      box.className = 'lo-app';
      // Through the DOM: the policy refuses a style attribute.
      Object.assign(box.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '1000',
        background: 'var(--lo-bg)',
      });
      document.body.append(box);
      const on = {
        cursor: hear('cursor'),
        mode: hear('mode'),
        jumped: hear('jumped'),
        menu: hear('menu'),
      };
      const vimKeys = registry().vimKeys();
      const view =
        kind === 'file'
          ? createFileView(
              box,
              {
                id: 'start',
                path: 'src/start.ts',
                lines: code,
                marks: [{ kind: 'lines', at: { file: 'start', side: 'new', from: 3, to: 5 } }],
                vimKeys,
                nonce,
              },
              on,
            )
          : createDiffView(
              box,
              {
                files: [
                  {
                    id: 'start',
                    path: 'src/start.ts',
                    change: 'modified',
                    lines: { old: [...before, '  serve();', '}'], new: code },
                    header: { additions: 1, deletions: 1 },
                  },
                  {
                    id: 'logo',
                    path: 'logo.png',
                    change: 'added',
                    skip: 'binary',
                    header: { additions: 0, deletions: 0 },
                  },
                ],
                note: { text: 'A diff on its own', tone: 'info' },
                layout: 'split',
                vimKeys,
                nonce,
              },
              { ...on, file: hear('file'), load: hear('load') },
            );
      mounted = { view, box };
      view.focus();
    },
    unmount,
  };
}
