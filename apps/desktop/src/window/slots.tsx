// Slots: places in one feature's screens that other features fill, so a feature adds a view, a
// panel or a header item to another's screen without editing it. The owner defines each slot with
// `defineSlot` in its `window/shared.ts` and renders it with `<Slot>`. Other features list what they
// put in it as `views` in their WindowFeature, each made with `defineView`. A view can come and go
// while the window runs, as a setting turns its feature off and on (`present`). Every view runs
// inside its own error boundary, however its owner renders it: one that fails shows a short note in
// its place, and the rest of the window goes on.

import { Problem } from '@lo/ui';
import {
  Component,
  createContext,
  createElement,
  use,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { detailsOf } from '../ipc/cause.ts';
import { channelName } from '../ipc/contract.ts';

/**
 * A place in a feature's screens that features put views in, named `<feature>.<name>`. A slot can
 * ask each view for more than its component, `Extra`: what its owner shows of the view elsewhere,
 * such as a middle view's label in the header's view switch.
 */
export interface Slot<Props, Extra extends object = object> {
  /** `<feature>.<name>`, for the feature that defines it and renders it. */
  readonly id: string;
  /** What the slot gives each view. Never set: it exists only for the type checker. */
  readonly props?: Props;
  /** What each view gives the slot besides its component. Never set, as `props` isn't. */
  readonly extra?: Extra;
}

/**
 * Defines a slot: `defineSlot<{ tab: TabId }>('tab.middle')`. The feature named first exports it
 * from its `window/shared.ts`, and renders it with `<Slot>`.
 */
export function defineSlot<Props extends object = object, Extra extends object = object>(
  id: string,
): Slot<Props, Extra> {
  if (!channelName.test(id)) {
    throw new Error(`A slot is named <feature>.<name>, as tab.middle is, not "${id}".`);
  }
  const slot = { id };
  defined.add(slot);
  return slot;
}

/** Every slot `defineSlot` made. */
const defined = new WeakSet<object>();

/** Whether `value` is a slot `defineSlot` made. */
export function isSlot(value: unknown): value is Slot<unknown> {
  return typeof value === 'object' && value !== null && defined.has(value);
}

/**
 * Whether a view is in its slot now, for one that comes and goes while the window runs, such as
 * every view of a feature a setting turns off: what it says now, and when that may change.
 */
export interface Presence {
  /** Whether the view is there now. */
  readonly now: () => boolean;
  /** Calls `listener` when `now` may say otherwise. Returns a function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** What a feature puts in a slot: a component, rendered with the slot's props. */
export interface View<Props = never> {
  readonly slot: Slot<unknown>;
  /** `<feature>.<name>`, for the feature that lists it. */
  readonly id: string;
  /** Where it goes among the slot's views: lower first, then by id. */
  readonly order: number;
  readonly render: (props: Props) => ReactNode;
  /**
   * Whether it's in its slot now, for a view that comes and goes. Without this it's always there.
   * Gone, its slot neither lists nor draws it, as though no feature had listed it.
   */
  readonly present?: Presence | undefined;
}

/**
 * Defines a view for a slot, its component typed by the slot's props, with what else the slot asks
 * of each view.
 */
export function defineView<Props, Extra extends object = object>(
  slot: Slot<Props, Extra>,
  view: {
    id: string;
    order: number;
    render: (props: Props) => ReactNode;
    present?: Presence | undefined;
  } & Extra,
): View {
  if (!channelName.test(view.id)) {
    throw new Error(`A view is named <feature>.<name>, as diff.files is, not "${view.id}".`);
  }
  return { slot, ...view };
}

/** A slot's views, in order, and how to follow those that come and go. */
interface SlotList {
  readonly views: readonly View[];
  /** Calls `listener` when any of its views may come or go. Returns a function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Which of its views are there now, as one string, the same while they stay the same. */
  readonly snapshot: () => string;
}

const NO_VIEWS: SlotList = { views: [], subscribe: () => () => {}, snapshot: () => '' };

/** Each slot's views, by the slot's id. */
const SlotViews = createContext<ReadonlyMap<string, SlotList>>(new Map());

/** `views`, a slot's in order, with how to follow those of them that come and go. */
function listOf(views: readonly View[]): SlotList {
  const presences = [...new Set(views.flatMap(({ present }) => (present ? [present] : [])))];
  return {
    views,
    subscribe: (listener) => {
      const stops = presences.map((presence) => presence.subscribe(listener));
      return () => {
        for (const stop of stops) stop();
      };
    },
    snapshot: () => presences.map((presence) => (presence.now() ? '1' : '0')).join(''),
  };
}

/** Gives every `<Slot>` inside it the views features list. Lo's window is inside one. */
export function Slots({ views, children }: { views: readonly View[]; children: ReactNode }) {
  const bySlot = useMemo(() => {
    const grouped = Map.groupBy(views.map(contain), (view) => view.slot.id);
    const lists = new Map<string, SlotList>();
    for (const [id, list] of grouped) {
      list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'));
      lists.set(id, listOf(list));
    }
    return lists;
  }, [views]);
  return <SlotViews value={bySlot}>{children}</SlotViews>;
}

/**
 * The views features put in `slot` that are there now, in order, for an owner that chooses among
 * them or lays each out itself, re-rendering as one comes or goes. `<Slot>` renders them all. Each
 * one's `render` runs inside its own error boundary.
 */
export function useViews<Props, Extra extends object = object>(
  slot: Slot<Props, Extra>,
): readonly (View<Props> & Extra)[] {
  const list = use(SlotViews).get(slot.id) ?? NO_VIEWS;
  const there = useSyncExternalStore(list.subscribe, list.snapshot, list.snapshot);
  const views = useMemo(
    // What `there` says is what the filter reads.
    () => list.views.filter(({ present }) => present?.now() ?? true),
    [list, there],
  );
  // `defineView` checked each one's component against its slot's props, and what else it gives.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return views as unknown as readonly (View<Props> & Extra)[];
}

/**
 * Renders every view features put in `slot`, in order, each with `props`. A view that throws
 * shows a short note in its place, and its error is logged; the slot's other views stay.
 */
export function Slot<Props extends object, Extra extends object = object>({
  slot,
  props,
}: {
  slot: Slot<Props, Extra>;
  props: Props;
}) {
  return useViews(slot).map((view) => createElement(view.render, { ...props, key: view.id }));
}

/** `view`, rendered inside its own error boundary. Made once per view, so it keeps its state. */
function contain(view: View): View {
  const { id, render } = view;
  // A component of the view's own, so its hooks are its own, inside the boundary.
  function Shown({ props }: { props: never }): ReactNode {
    return render(props);
  }
  function ContainedView(props: never): ReactNode {
    return (
      <Contained id={id}>
        <Shown props={props} />
      </Contained>
    );
  }
  return { ...view, render: ContainedView };
}

/**
 * Whether a view that fails also stops the window, after its note is logged: in a build run from
 * source, so its tests can't miss it. A packaged Lo shows the note and goes on.
 */
let loud = false;

/** Makes a view that fails stop the window too, as a build run from source should. */
export function failViewsLoudly(on = true): void {
  loud = on;
}

/**
 * Draws `children`, a part of view `id` that its slot's owner draws itself, such as a middle view's
 * mark in the view switch, as the view itself is drawn: one that throws shows a short note in its
 * place, and its error is logged.
 */
export function ViewPart({ id, children }: { id: string; children: ReactNode }) {
  return <Contained id={id}>{children}</Contained>;
}

/** Whether a view threw, and what it threw, for Details. */
interface Failed {
  readonly failed: boolean;
  readonly details?: string | undefined;
}

/**
 * One view, which shows an error in its place, with what it threw behind Details, and logs why,
 * when it throws. "Try again" draws it again.
 */
class Contained extends Component<{ id: string; children: ReactNode }, Failed> {
  override state: Failed = { failed: false };

  static getDerivedStateFromError(error: unknown): Failed {
    const said =
      error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
    return { failed: true, details: detailsOf(said) };
  }

  override componentDidCatch(error: unknown): void {
    console.error(`Lo couldn't show the view ${this.props.id}:`, error);
    if (loud) throw error;
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="p-8" data-lo-failed-view={this.props.id}>
        <Problem
          title="Can’t show this view"
          action={{ label: 'Try again', onClick: () => this.setState({ failed: false }) }}
          details={this.state.details}
        />
      </div>
    );
  }
}
