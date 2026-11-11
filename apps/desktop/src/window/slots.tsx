// Slots: places in one feature's screens that other features fill, so a feature adds a view, a
// panel or a header item to another's screen without editing it. The owner defines each slot with
// `defineSlot` in its `window/shared.ts` and renders it with `<Slot>`. Other features list what they
// put in it as `views` in their WindowFeature, each made with `defineView`.

import { createContext, createElement, use, useMemo, type ReactNode } from 'react';

import { channelName } from '../ipc/contract.ts';

/** A place in a feature's screens that features put views in, named `<feature>.<name>`. */
export interface Slot<Props> {
  /** `<feature>.<name>`, for the feature that defines it and renders it. */
  readonly id: string;
  /** What the slot gives each view. Never set: it exists only for the type checker. */
  readonly props?: Props;
}

/**
 * Defines a slot: `defineSlot<{ tab: TabId }>('tab.middle')`. The feature named first exports it
 * from its `window/shared.ts`, and renders it with `<Slot>`.
 */
export function defineSlot<Props extends object = object>(id: string): Slot<Props> {
  if (!channelName.test(id)) {
    throw new Error(`A slot is named <feature>.<name>, as tab.middle is, not "${id}".`);
  }
  return { id };
}

/** What a feature puts in a slot: a component, rendered with the slot's props. */
export interface View<Props = never> {
  readonly slot: Slot<unknown>;
  /** `<feature>.<name>`, for the feature that lists it. */
  readonly id: string;
  /** Where it goes among the slot's views: lower first, then by id. */
  readonly order: number;
  readonly render: (props: Props) => ReactNode;
}

/** Defines a view for a slot, its component typed by the slot's props. */
export function defineView<Props>(
  slot: Slot<Props>,
  view: { id: string; order: number; render: (props: Props) => ReactNode },
): View {
  if (!channelName.test(view.id)) {
    throw new Error(`A view is named <feature>.<name>, as diff.files is, not "${view.id}".`);
  }
  return { slot, ...view };
}

/** Each slot's views, by the slot's id, in order. */
const SlotViews = createContext<ReadonlyMap<string, readonly View[]>>(new Map());

/** Gives every `<Slot>` inside it the views features list. Lo's window is inside one. */
export function Slots({ views, children }: { views: readonly View[]; children: ReactNode }) {
  const bySlot = useMemo(() => {
    const grouped = Map.groupBy(views, (view) => view.slot.id);
    for (const list of grouped.values()) {
      list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'));
    }
    return grouped;
  }, [views]);
  return <SlotViews value={bySlot}>{children}</SlotViews>;
}

/**
 * The views features put in `slot`, in order, for an owner that chooses among them or lays each
 * out itself. `<Slot>` renders them all.
 */
export function useViews<Props>(slot: Slot<Props>): readonly View<Props>[] {
  // `defineView` checked each one's component against its slot's props.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (use(SlotViews).get(slot.id) ?? []) as readonly View<Props>[];
}

/** Renders every view features put in `slot`, in order, each with `props`. */
export function Slot<Props extends object>({ slot, props }: { slot: Slot<Props>; props: Props }) {
  return useViews(slot).map((view) => createElement(view.render, { ...props, key: view.id }));
}
