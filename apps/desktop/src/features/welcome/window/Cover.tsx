// The welcome, over a tab: four steps, one job each, that a first-time reader walks with
// "Continue", "Back" and "Skip", by mouse or by key. It opens by itself over the Recent tab until
// the reader has finished it or signed in, and "Welcome to Lo" opens it again over any tab. It's a
// form like Settings, so `Tab` walks its controls.

import { Button, Key } from '@lo/ui';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { focusMiddle, setMiddle, useKeys } from '../../../window/commands/registry.ts';
import { useAccounts } from '../../accounts/window/shared.ts';
import { activeTab, useTabs, type Tab } from '../../tab/window/shared.ts';
import { AccountStep } from './Account.tsx';
import { back, leave, loadGh, next, openFirst, setScreen } from './actions.ts';
import { KeysStep } from './Keys.tsx';
import { keyOf } from './labels.ts';
import { OpenStep } from './Open.tsx';
import { escapePractice } from './practice.ts';
import { SetupStep } from './Setup.tsx';
import { STEPS, welcomeStore, type Step } from './store.ts';

/**
 * Whether focus is nowhere a reader put it: dropped, on the middle itself, or on something out of
 * reach, as the view under the welcome is.
 */
function lost(): boolean {
  const now = document.activeElement;
  return (
    !now ||
    now === document.body ||
    !now.isConnected ||
    now.hasAttribute('data-lo-middle') ||
    now.closest('[inert]') !== null
  );
}

/** A dialog or the palette, over the window. */
const OVER = '[role="dialog"]';

/**
 * Calls `then` once nothing is over the window: at once when nothing is, or else as the dialog or
 * palette that is goes, which keeps focus until then. Returns what stops waiting.
 */
function onceClear(then: () => void): () => void {
  if (document.querySelector(OVER) === null) {
    then();
    return () => undefined;
  }
  const watch = new MutationObserver(() => {
    if (document.querySelector(OVER) !== null) return;
    watch.disconnect();
    then();
  });
  watch.observe(document.body, { childList: true, subtree: true });
  return () => watch.disconnect();
}

/** Gives focus to the view the welcome covered, once it's gone, if focus was dropped with it. */
function giveFocusBack(): void {
  onceClear(() => {
    if (lost()) focusMiddle();
  });
}

// Every step is laid out in the same cell, so the welcome is as tall as its tallest step from the
// start, and its foot never moves under the pointer. The one on screen fades in as `Swap` does.
const STEP_BOX = 'col-start-1 row-start-1 flex min-w-0 flex-col gap-24';
const BALL = 'size-8 rounded-pill move-tint';

/** Where the walk is: a ball for each step, filled up to the one on screen. */
function Progress({ step }: { step: Step }) {
  const at = STEPS.indexOf(step);
  return (
    <div className="flex items-center gap-8">
      {STEPS.map((each, index) => (
        <span
          key={each}
          className={`${BALL} ${index <= at ? 'bg-fg' : 'text-border-strong hollow'}`}
          aria-hidden="true"
        />
      ))}
      <span role="status" className="sr-only">
        Step {at + 1} of {STEPS.length}
      </span>
    </div>
  );
}

/** A foot button that keeps its room while it has nothing to do on this step. */
function Held({ away, children }: { away: boolean; children: ReactNode }) {
  return <span className={away ? 'invisible' : undefined}>{children}</span>;
}

const STEP_VIEWS: Readonly<Record<Step, (props: { shown: boolean }) => ReactNode>> = {
  account: AccountStep,
  keys: KeysStep,
  setup: SetupStep,
  open: OpenStep,
};

/** The welcome. It covers what's under it, so nothing there is reached by key or by reader. */
function Welcome(): ReactNode {
  useKeys();
  const root = useRef<HTMLDivElement>(null);
  const step = useStore(welcomeStore, (state) => state.step);
  const accounts = useAccounts();
  const signedIn = accounts?.some((account) => account.signedOut === null) ?? false;

  // Under the welcome sits the tab's own view, which takes focus and keys of its own: put it out
  // of reach while the welcome is up.
  useLayoutEffect(() => {
    const screen = root.current;
    const under = screen?.parentElement;
    if (!screen || !under) return undefined;
    const covered = [...under.children].filter(
      (each) => each !== screen && !each.hasAttribute('inert'),
    );
    for (const each of covered) each.setAttribute('inert', '');
    setScreen(screen);
    welcomeStore.setState({ shown: true });
    return () => {
      for (const each of covered) each.removeAttribute('inert');
      setScreen(undefined);
      welcomeStore.setState({ shown: false });
    };
  }, []);

  /** Puts focus where the step starts: on what it marks, or else on the foot's main button. */
  const focusStep = () => {
    const screen = root.current;
    const now = welcomeStore.getState().step;
    const first =
      screen?.querySelector<HTMLElement>(`[data-welcome-step="${now}"] [data-welcome-focus]`) ??
      screen?.querySelector<HTMLElement>('[data-welcome-default]');
    first?.focus();
  };

  useEffect(() => {
    const takeBack = setMiddle({
      focus: focusStep,
      here: () => undefined,
      escape: escapePractice,
    });
    void loadGh();
    return () => {
      takeBack();
      giveFocusBack();
      // A pull request that opens while the welcome is up, from it or from anywhere else, is what
      // the reader came for: the welcome is over.
      const { open, over } = welcomeStore.getState();
      const now = activeTab();
      if (open && now !== undefined && now.id !== over && now.kind !== 'recent') {
        if (now.kind !== 'settings') leave();
      }
    };
  }, []);

  // Each step starts with focus on its own first control, once nothing is over the welcome.
  useEffect(
    () =>
      onceClear(() => {
        if (lost() || root.current?.contains(document.activeElement) === true) focusStep();
      }),
    [step],
  );

  // Signing in takes the button that had focus away: focus dropped with it goes to the step.
  useEffect(
    () =>
      onceClear(() => {
        if (lost()) focusStep();
      }),
    [signedIn],
  );

  const first = step === STEPS[0];
  const last = step === STEPS.at(-1);
  // The first step's own button, signing in, is its main one until an account is signed in.
  const own = first && !signedIn;
  const key = keyOf('welcome.continue');
  return (
    <div
      ref={root}
      tabIndex={-1}
      data-lo-scope="welcome"
      data-lo-tab="browser"
      className="absolute inset-0 flex overflow-auto bg-bg px-24 py-32 focus-visible:shadow-none"
    >
      <div className="m-auto flex w-palette-w max-w-full flex-col gap-32">
        <div className="grid">
          {STEPS.map((each) => {
            const View = STEP_VIEWS[each];
            const shown = each === step;
            return (
              <section
                key={each}
                data-welcome-step={each}
                aria-hidden={shown ? undefined : true}
                inert={!shown}
                className={`${STEP_BOX} ${shown ? 'move-swap' : 'invisible'}`}
              >
                <View shown={shown} />
              </section>
            );
          })}
        </div>
        <div className="flex items-center gap-8 border-t border-border-subtle pt-16">
          <div className="flex flex-1 justify-start">
            <Held away={first}>
              <Button variant="ghost" disabled={first} onClick={back}>
                Back
              </Button>
            </Held>
          </div>
          <Progress step={step} />
          <div className="flex flex-1 items-center justify-end gap-8">
            <Held away={last}>
              <Button variant="ghost" disabled={last} onClick={leave}>
                Skip
              </Button>
            </Held>
            <Button
              variant={own ? 'secondary' : 'primary'}
              {...(own ? {} : { 'data-welcome-default': true })}
              onClick={next}
            >
              {/* Both labels take the room of the longer, so the button holds still. */}
              <span className="inline-grid justify-items-center">
                <span className="col-start-1 row-start-1">{last ? 'Done' : 'Continue'}</span>
                <span className="invisible col-start-1 row-start-1" aria-hidden="true">
                  Continue
                </span>
              </span>
              {!own && key && <Key keys={key} decorative className="text-on-accent" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The welcome, over the tab it's open on. It opens by itself over the Recent tab for a reader who
 * hasn't finished it and has no account signed in: none, or only ones GitHub refused. Until Lo
 * knows both, the Recent tab is covered by plain ground, so its list never shows for a moment under
 * a welcome that's about to open. Other tabs are drawn as they are unless the reader asked for the
 * welcome there.
 */
export function Cover({ tab }: { tab: Tab }): ReactNode {
  const accounts = useAccounts();
  const { tabs } = useTabs();
  const open = useStore(welcomeStore, (state) => state.open);
  const over = useStore(welcomeStore, (state) => state.over);
  const finished = useStore(welcomeStore, (state) => state.finished);
  const known = accounts !== undefined && finished !== undefined;
  const signedIn = accounts?.some((account) => account.signedOut === null) ?? false;
  const recent = tab.kind === 'recent';
  const first = known && recent && !open && !finished && !signedIn;
  // The tab the reader asked for it over has closed: it's no longer open anywhere.
  const gone = open && over !== undefined && !tabs.some((each) => each.id === over);

  useLayoutEffect(() => {
    if (first) openFirst();
    else if (gone) welcomeStore.setState({ open: false, over: undefined });
  }, [first, gone]);

  if (open && !gone && (over === undefined ? recent : tab.id === over)) return <Welcome />;
  // Not known yet, or about to open: the ground alone.
  if (recent && (!known || first)) return <div className="absolute inset-0 bg-bg" />;
  return null;
}
