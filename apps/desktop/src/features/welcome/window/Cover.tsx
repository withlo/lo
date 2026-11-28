// The welcome, over a tab: six steps, one job each, that a first-time reader walks with
// "Continue", "Back" and "Skip", by mouse or by key. It opens by itself over the Recent tab until
// the reader has finished it or signed in, and "Welcome to Lo" opens it again over any tab. It's a
// form like Settings, so `Tab` walks its controls. Its foot stays on screen: in a window too short
// for a step, the step scrolls under it.

import { Button, Key, reveal, Swap } from '@lo/ui';
import { controlOf, runControl } from '@lo/ui/commands';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';

import { focusMiddle, setMiddle, useKeys } from '../../../window/commands/registry.ts';
import { useAccounts, useAccountsHeard } from '../../accounts/window/shared.ts';
import { activeTab, useTabs, type Tab } from '../../tab/window/shared.ts';
import { AccountStep } from './Account.tsx';
import { leave, loadGh, next, openFirst, setScreen, touch } from './actions.ts';
import { KeysStep } from './Keys.tsx';
import { keyOf } from './labels.ts';
import { LookStep } from './Look.tsx';
import { OpenStep } from './Open.tsx';
import { OverviewsStep } from './Overviews.tsx';
import { practiceEscape } from './practice.ts';
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
// start, and its foot never moves under the pointer. The one on screen fades in, in a `Swap`.
const STEP_CELL = 'col-start-1 row-start-1 min-w-0';
const STEP_BOX = 'flex min-w-0 flex-col gap-24';
const BALL = 'size-8 rounded-pill move-tint';

/** A step's ball, by where the walk is: done, the one on screen, or not yet. */
const BALLS = { done: 'bg-fg', here: 'bg-accent', ahead: 'text-fg-subtle hollow' } as const;

/** Where step `index` is, with the walk at step `at`. */
function ballOf(index: number, at: number): keyof typeof BALLS {
  if (index < at) return 'done';
  if (index === at) return 'here';
  return 'ahead';
}

/** Where the walk is: a ball for each step, the one on screen in the accent. */
function Progress({ step }: { step: Step }) {
  const at = STEPS.indexOf(step);
  const said = `Step ${at + 1} of ${STEPS.length}`;
  // Said aloud once the reader moves: the step the welcome opens on isn't news.
  const start = useRef(step);
  const [moved, setMoved] = useState(false);
  if (!moved && step !== start.current) setMoved(true);
  return (
    <>
      <div role="img" aria-label={said} className="flex items-center gap-8">
        {STEPS.map((each, index) => {
          const ball = ballOf(index, at);
          return <span key={each} data-ball={ball} className={`${BALL} ${BALLS[ball]}`} />;
        })}
      </div>
      <span role="status" className="sr-only">
        {moved ? said : ''}
      </span>
    </>
  );
}

/** A foot button that keeps its room while it has nothing to do on this step. */
function Held({ away, children }: { away: boolean; children: ReactNode }) {
  return <span className={away ? 'invisible' : undefined}>{children}</span>;
}

/**
 * Brings what took focus in a step into view above the foot, in the steps' own pane. What has a
 * scope of its own, as the practice's comment box does, keeps its own scrolling.
 */
function revealFocused(event: FocusEvent<HTMLElement>): void {
  revealInStep(event.target);
}

/** Brings `target`, in a step, into view, as {@link revealFocused} says. */
function revealInStep(target: Element): void {
  if (target.closest('[data-lo-scope]')?.getAttribute('data-lo-scope') !== 'welcome') return;
  reveal(target);
}

const BACK = 'welcome.back';

/**
 * "Back", `welcome.back`'s control: the step before, with its key in its tooltip. The foot's main
 * button carries the one chip. On the first step there's no step before, and it keeps its room.
 */
function BackButton({ first }: { first: boolean }) {
  const control = controlOf(BACK);
  if (!control) return null;
  const off = control.off !== undefined;
  return (
    <Held away={first}>
      <Button
        variant="ghost"
        disabled={off}
        // Its key, with its name, where it has one: its name alone would only say its words again.
        hint={off ? '' : control.keys === undefined ? null : control.label}
        hintKeys={off ? undefined : control.keys}
        hintShortcut={off ? undefined : control.shortcut}
        onClick={() => {
          if (!off) runControl(BACK);
        }}
      >
        {control.label}
      </Button>
    </Held>
  );
}

const STEP_VIEWS: Readonly<Record<Step, (props: { shown: boolean }) => ReactNode>> = {
  account: AccountStep,
  look: LookStep,
  keys: KeysStep,
  overviews: OverviewsStep,
  setup: SetupStep,
  open: OpenStep,
};

/** The welcome. It covers what's under it, so nothing there is reached by key or by reader. */
function Welcome(): ReactNode {
  useKeys();
  const root = useRef<HTMLDivElement>(null);
  const step = useStore(welcomeStore, (state) => state.step);
  const linked = useStore(welcomeStore, (state) => state.linked);
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

  /**
   * Where the step starts: what it marks, a group of cards at its chosen card, or else the foot's
   * main button.
   */
  const stepStart = () => {
    const screen = root.current;
    const now = welcomeStore.getState().step;
    const marked = screen?.querySelector<HTMLElement>(
      `[data-welcome-step="${now}"] [data-welcome-focus]`,
    );
    return (
      marked?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ??
      marked ??
      screen?.querySelector<HTMLElement>('[data-welcome-default]')
    );
  };
  /** Puts focus where the step starts. */
  const focusStep = () => stepStart()?.focus();

  useEffect(() => {
    const takeBack = setMiddle({
      focus: focusStep,
      holds: (element) => element === stepStart(),
      here: () => undefined,
      escape: practiceEscape,
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

  // Each step starts at its top, in a window too short for it, wherever the step before was
  // scrolled to; what takes focus in it then comes into view by itself.
  const pane = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (pane.current) pane.current.scrollTop = 0;
  }, [step]);

  // What has focus in a step stays in view as the pane's room changes, as on a zoom, which moves
  // everything in it.
  useEffect(() => {
    const element = pane.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const sized = new ResizeObserver(() => {
      const focused = document.activeElement;
      if (focused && element.contains(focused)) revealInStep(focused);
    });
    sized.observe(element);
    return () => sized.disconnect();
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
  // The step's own button is its main one: signing in on the first until an account is signed in,
  // and on the last, opening the link once the field holds one.
  const own = (first && !signedIn) || (last && linked);
  const key = keyOf('welcome.continue');
  return (
    <div
      ref={root}
      tabIndex={-1}
      data-lo-scope="welcome"
      data-lo-tab="browser"
      onKeyDownCapture={touch}
      onPointerDownCapture={touch}
      onClickCapture={touch}
      className="absolute inset-0 flex flex-col bg-bg focus-visible:shadow-none"
    >
      {/* The steps, in a column as wide as a palette at every window width, over the foot. Where
          the window is too short for them, they scroll in a pane of their own and the foot stays
          on screen under them; where it isn't, the two sit in the middle together. */}
      <div
        ref={pane}
        className="mt-auto min-h-0 reveal-room overflow-auto px-24 pt-32 pb-32 gutter-both"
        onFocus={revealFocused}
      >
        <div className="mx-auto grid w-palette-w max-w-full">
          {STEPS.map((each) => {
            const View = STEP_VIEWS[each];
            const shown = each === step;
            return (
              <section
                key={each}
                data-welcome-step={each}
                aria-hidden={shown ? undefined : true}
                inert={!shown}
                className={`${STEP_CELL} ${shown ? '' : 'invisible'}`}
              >
                {/* Drawn afresh as it shows, and as it goes, so each step shows how it stands. */}
                <Swap id={shown ? 'shown' : 'hidden'} className={STEP_BOX}>
                  <View shown={shown} />
                </Swap>
              </section>
            );
          })}
        </div>
      </div>
      <div className="mb-auto flex-none px-24 pb-32">
        <div className="mx-auto flex w-palette-w max-w-full items-center gap-8 border-t border-border-subtle pt-16">
          {/* Back's label starts where the column does, as the steps' own words do. */}
          <div className="-ms-12 flex flex-1 justify-start">
            <BackButton first={first} />
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
              {/* It holds the room of "Continue" with its key in every state, its words in the
                  middle, so neither it nor Skip moves as its words or its key come and go. */}
              <span className="inline-grid place-items-center">
                <span className="col-start-1 row-start-1 inline-flex items-center gap-6">
                  {last ? 'Done' : 'Continue'}
                  {!own && key && <Key keys={key} decorative className="text-on-accent" />}
                </span>
                <span
                  className="invisible col-start-1 row-start-1 inline-flex items-center gap-6"
                  aria-hidden="true"
                >
                  Continue
                  {key && <Key keys={key} decorative />}
                </span>
              </span>
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
 * welcome there. Signing in from the welcome doesn't close it, but an account that signs in before
 * the reader has touched it does.
 */
export function Cover({ tab }: { tab: Tab }): ReactNode {
  const accounts = useAccounts();
  const heard = useAccountsHeard();
  const { tabs } = useTabs();
  const open = useStore(welcomeStore, (state) => state.open);
  const over = useStore(welcomeStore, (state) => state.over);
  const finished = useStore(welcomeStore, (state) => state.finished);
  const touched = useStore(welcomeStore, (state) => state.touched);
  // Accounts main couldn't list count as known: none is signed in that the window knows of.
  const known = heard && finished !== undefined;
  const signedIn = accounts?.some((account) => account.signedOut === null) ?? false;
  const recent = tab.kind === 'recent';
  const first = known && recent && !open && !finished && !signedIn;
  // The tab the reader asked for it over has closed: it's no longer open anywhere.
  const gone = open && over !== undefined && !tabs.some((each) => each.id === over);

  // An account signed in before the reader touched the welcome, as one added from another window
  // or as Lo starts: it opened for want of one, so it goes. Signing in from it keeps it.
  const idle = open && over === undefined && signedIn && !touched;

  useLayoutEffect(() => {
    if (first) openFirst();
    else if (gone) welcomeStore.setState({ open: false, over: undefined });
    else if (idle) welcomeStore.setState({ open: false });
  }, [first, gone, idle]);

  if (open && !gone && (over === undefined ? recent : tab.id === over)) return <Welcome />;
  // Not known yet, or about to open: the ground alone.
  if (recent && (!known || first)) return <div className="absolute inset-0 bg-bg" />;
  return null;
}
