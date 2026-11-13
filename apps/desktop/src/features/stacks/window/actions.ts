// What making a chain a GitHub stack does in the window: `gS` asks main for a plan for the pull
// request on screen, then shows it to confirm, or says every reason there's none. The dialog's
// buttons confirm the plan by its key, stop it, put its base branches back or plan again. Main
// sends every change; the window never names one.

import { IpcError } from '../../../ipc/contract.ts';
import { announce, notify } from '../../../window/commands/notices.tsx';
import { activeTab } from '../../tab/window/shared.ts';
import type { ConversionView } from '../contract.ts';
import { main } from './main.ts';
import { stacksStore, type Dialog } from './store.ts';

/** What `gS` is called, as notes about it say. */
export const TITLE = 'Make this a GitHub stack';

/** How long planning goes before the dialog opens to say it's waiting, in milliseconds. */
export const PLANNING_SHOWS_AFTER = 400;

/** Each time a plan is asked for, so an answer to an older one is let go. */
let asked = 0;

function dialogNow(): Dialog | undefined {
  return stacksStore.getState().dialog;
}

function setDialog(dialog: Dialog | undefined): void {
  stacksStore.setState({ dialog });
}

function log(error: unknown): void {
  console.error('stacks:', error);
}

/** What went wrong asking main, in words to show. */
function whyNot(error: unknown): string {
  return error instanceof IpcError ? error.message : 'Lo couldn’t ask for it. Try again.';
}

/** Whether `gS` can run now, or why not: it needs a pull request on screen. */
export function canMakeStack(): true | string {
  return activeTab()?.kind === 'pull' ? true : 'There’s no pull request on screen.';
}

/** `gS`: makes the chain the pull request on screen is in a GitHub stack. */
export function makeStackOnScreen(): void {
  const tab = activeTab();
  if (tab?.kind === 'pull') makeStack(tab.id, tab.number);
}

/**
 * Asks main to plan making the chain pull request `number`, in tab `tab`, is in a GitHub stack,
 * then shows the plan to confirm, or says every reason there's none. Nothing changes on GitHub
 * until the reader confirms. While the dialog is open, it does nothing.
 */
export function makeStack(tab: string, number: number): void {
  if (dialogNow() !== undefined) return;
  const turn = ++asked;
  setDialog({ kind: 'planning', tab, number, shown: false });
  const timer = setTimeout(() => {
    const now = dialogNow();
    if (turn === asked && now?.kind === 'planning') setDialog({ ...now, shown: true });
  }, PLANNING_SHOWS_AFTER);
  main()
    .plan({ id: tab })
    .then(
      (planned) => {
        clearTimeout(timer);
        if (turn !== asked || dialogNow()?.kind !== 'planning') {
          // The reader closed the dialog meanwhile: main forgets the plan.
          if (planned.kind === 'plan') main().stop({ key: planned.key }).catch(log);
          return;
        }
        if (planned.kind === 'notOffered') {
          setDialog(undefined);
          notify(TITLE, planned.reasons.join('\n'));
          return;
        }
        setDialog({
          kind: 'confirm',
          tab,
          number,
          plan: planned,
          sending: false,
          problem: undefined,
        });
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (turn !== asked || dialogNow()?.kind !== 'planning') return;
        setDialog(undefined);
        notify(TITLE, whyNot(error));
      },
    );
}

/** `⏎` on the plan: main runs it, once. */
export function confirm(): void {
  const now = dialogNow();
  if (now?.kind !== 'confirm' || now.sending) return;
  const { key } = now.plan;
  setDialog({ ...now, sending: true, problem: undefined });
  main()
    .convert({ key })
    .then(
      (view) => {
        const at = dialogNow();
        if (at?.kind === 'confirm' && at.plan.key === key) {
          setDialog({ kind: 'conversion', tab: at.tab, number: at.number, key });
        }
        take(view);
      },
      (error: unknown) => {
        const at = dialogNow();
        if (at?.kind === 'confirm' && at.plan.key === key) {
          setDialog({ ...at, sending: false, problem: whyNot(error) });
        }
      },
    );
}

/** Whether the conversion named `key` is sending changes, as main last said. */
function sending(view: ConversionView | undefined): boolean {
  return view?.phase === 'running' || view?.phase === 'puttingBack';
}

/**
 * `Esc`, Cancel and Close: closes the dialog, and main forgets what it kept for it. While changes
 * are being sent, it stops them before the next one instead, and the dialog stays to say how far
 * they went.
 */
export function dismiss(): void {
  const now = dialogNow();
  if (!now) return;
  switch (now.kind) {
    case 'planning':
      asked += 1;
      setDialog(undefined);
      return;
    case 'confirm':
      if (now.sending) return;
      setDialog(undefined);
      main().stop({ key: now.plan.key }).catch(log);
      return;
    case 'conversion': {
      const view = stacksStore.getState().conversions.get(now.key);
      if (sending(view)) {
        if (!view?.stopping) main().stop({ key: now.key }).catch(log);
        return;
      }
      setDialog(undefined);
      forget(now.key);
      return;
    }
    default:
      throw new Error(`a dialog Lo doesn't know: ${JSON.stringify(now satisfies never)}`);
  }
}

/** Puts back the base branches the conversion on screen changed. */
export function putBack(): void {
  const now = dialogNow();
  if (now?.kind !== 'conversion') return;
  if (sending(stacksStore.getState().conversions.get(now.key))) return;
  main()
    .putBack({ key: now.key })
    .then(take, (error: unknown) => notify('Put the base branches back', whyNot(error)));
}

/** Plans again, from what GitHub says now, and asks again. */
export function tryAgain(): void {
  const now = dialogNow();
  if (now?.kind !== 'conversion') return;
  if (sending(stacksStore.getState().conversions.get(now.key))) return;
  setDialog(undefined);
  forget(now.key);
  makeStack(now.tab, now.number);
}

/** Forgets the conversion named `key`, here and in main. */
function forget(key: string): void {
  const conversions = new Map(stacksStore.getState().conversions);
  conversions.delete(key);
  stacksStore.setState({ conversions });
  main().stop({ key }).catch(log);
}

/**
 * Takes what main says of a conversion. Once it's done, the dialog showing it closes, and a toast
 * says what was made.
 */
export function take(view: ConversionView): void {
  const kept = stacksStore.getState().conversions.get(view.key);
  // An answer can come after what main said since.
  const latest = kept && kept.version > view.version ? kept : view;
  if (latest !== kept) {
    const conversions = new Map(stacksStore.getState().conversions);
    conversions.set(view.key, view);
    stacksStore.setState({ conversions });
  }
  const now = dialogNow();
  if (latest.phase !== 'done' || now?.kind !== 'conversion' || now.key !== latest.key) return;
  setDialog(undefined);
  forget(latest.key);
  announce(latest.made ?? 'Made the GitHub stack');
}
