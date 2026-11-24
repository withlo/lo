// What converting a chain to a GitHub stack does in the window: `gS` asks main for a plan for the
// pull request on screen, then shows it to confirm, or says every reason there's none. The dialog's
// buttons confirm the plan by its key, stop it, undo its changes or plan again. Main sends every
// change; the window never names one.

import { IpcError } from '../../../ipc/contract.ts';
import { announce, refuse } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract as tabs } from '../../tab/contract.ts';
import { withoutBidi } from '../../tab/window/shared.ts';
import type { ConversionView } from '../contract.ts';
import { main } from './main.ts';
import { stacksStore, type Dialog, type Failure } from './store.ts';

/** The dialog's title, in every state. */
export const TITLE = 'Convert to GitHub stack?';

/** Its main button, which converts. */
export const CONVERT = 'Convert to GitHub stack';

/** What's said once a conversion is done: the dialog's line, or a toast once it has closed. */
export const CONVERTED = 'Converted to GitHub stack';

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

/**
 * Why asking main failed: main's own reason, which may name a branch, GitHub's text that may carry
 * bidi controls; for anything else, no reason, and the error's words.
 */
function failureOf(error: unknown): Failure {
  if (error instanceof IpcError) return { reason: withoutBidi(error.message), details: null };
  return { reason: null, details: error instanceof Error ? error.message : String(error) };
}

/**
 * Asks main to plan converting the chain pull request `number`, in tab `tab`, is in to a GitHub
 * stack, then shows the plan to confirm, or says every reason there's none. Nothing changes on
 * GitHub until the reader confirms. While the dialog is open, it does nothing.
 */
export function makeStack(tab: string, number: number): void {
  if (dialogNow() !== undefined) return;
  planAgain(tab, number, false);
}

/**
 * Plans for pull request `number` in tab `tab`, the dialog showing it's checking at once when
 * `shown`, or once planning takes a moment.
 */
function planAgain(tab: string, number: number, shown: boolean): void {
  const turn = ++asked;
  setDialog({ kind: 'planning', tab, number, shown, problem: undefined });
  const timer = shown
    ? undefined
    : setTimeout(() => {
        const now = dialogNow();
        if (turn === asked && now?.kind === 'planning') setDialog({ ...now, shown: true });
      }, PLANNING_SHOWS_AFTER);
  const failed = (problem: Failure) => {
    const now = dialogNow();
    if (now?.kind === 'planning') setDialog({ ...now, shown: true, problem });
  };
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
        switch (planned.kind) {
          case 'notOffered':
            setDialog(undefined);
            // Reasons name branches, GitHub's text, which may carry bidi controls.
            refuse(withoutBidi(planned.reasons.join('\n')));
            return;
          case 'unchecked':
            failed({
              reason: planned.reason === null ? null : withoutBidi(planned.reason),
              details: planned.details,
            });
            return;
          case 'plan':
            setDialog({
              kind: 'confirm',
              tab,
              number,
              plan: planned,
              sending: false,
              problem: undefined,
            });
            return;
          default:
            throw new Error(`a plan Lo doesn’t know: ${JSON.stringify(planned satisfies never)}`);
        }
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (turn !== asked) return;
        failed(failureOf(error));
      },
    );
}

/** `⏎` on the plan: main runs it, once. */
export function confirm(): void {
  const now = dialogNow();
  if (now?.kind !== 'confirm' || now.sending) return;
  const { plan } = now;
  const { key } = plan;
  setDialog({ ...now, sending: true, problem: undefined });
  main()
    .convert({ key })
    .then(
      (view) => {
        const at = dialogNow();
        if (at?.kind === 'confirm' && at.plan.key === key) {
          setDialog({
            kind: 'conversion',
            tab: at.tab,
            number: at.number,
            key,
            plan,
            asking: false,
            problem: undefined,
          });
        }
        take(view);
      },
      (error: unknown) => {
        const at = dialogNow();
        if (at?.kind === 'confirm' && at.plan.key === key) {
          setDialog({ ...at, sending: false, problem: failureOf(error) });
        }
      },
    );
}

/** Whether the conversion named `key` is sending changes, as main last said. */
function sending(view: ConversionView | undefined): boolean {
  return view?.phase === 'running' || view?.phase === 'puttingBack';
}

/**
 * `Esc`, Cancel, Close and Done: closes the dialog, and main forgets what it kept for it. While
 * changes are being sent, Cancel stops them before the next one instead, and the dialog stays to
 * say how far they went.
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
      if (now.asking) return;
      setDialog(undefined);
      forget(now.key);
      return;
    }
    default:
      throw new Error(`a dialog Lo doesn’t know: ${JSON.stringify(now satisfies never)}`);
  }
}

/** Undoes the changes the conversion on screen made, asking main once. */
export function putBack(): void {
  const now = dialogNow();
  if (now?.kind !== 'conversion' || now.asking) return;
  if (sending(stacksStore.getState().conversions.get(now.key))) return;
  const { key } = now;
  setDialog({ ...now, asking: true, problem: undefined });
  const answered = (problem?: Failure) => {
    const at = dialogNow();
    if (at?.kind === 'conversion' && at.key === key) setDialog({ ...at, asking: false, problem });
  };
  main()
    .putBack({ key })
    .then(
      (view) => {
        answered();
        take(view);
      },
      (error: unknown) => answered(failureOf(error)),
    );
}

/** Plans again, from what GitHub says now, and asks again, in the dialog as it is. */
export function tryAgain(): void {
  const now = dialogNow();
  if (!now) return;
  switch (now.kind) {
    case 'planning':
      break;
    case 'confirm':
      if (now.sending) return;
      main().stop({ key: now.plan.key }).catch(log);
      break;
    case 'conversion':
      if (now.asking || sending(stacksStore.getState().conversions.get(now.key))) return;
      forget(now.key);
      break;
    default:
      throw new Error(`a dialog Lo doesn’t know: ${JSON.stringify(now satisfies never)}`);
  }
  planAgain(now.tab, now.number, true);
}

/** Opens `url`, GitHub's page for what isn't confirmed, in the browser. */
export function openOnGithub(url: string): void {
  client(tabs).openExternal({ url }).catch(log);
}

/** Forgets the conversion named `key`, here and in main. */
function forget(key: string): void {
  const conversions = new Map(stacksStore.getState().conversions);
  conversions.delete(key);
  stacksStore.setState({ conversions });
  main().stop({ key }).catch(log);
}

/**
 * Takes what main says of a conversion. Once it's done, the dialog showing it says so; one done
 * after its dialog closed is a toast.
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
  if (latest.phase !== 'done' || (now?.kind === 'conversion' && now.key === latest.key)) return;
  forget(latest.key);
  announce(CONVERTED);
}
