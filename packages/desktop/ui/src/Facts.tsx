import { Fragment, type ReactNode } from 'react';

import { Avatar } from './Avatar.tsx';
import { withoutBidi } from './controls.ts';

/** One fact a confirmation states: what it is, and what it says. */
export interface FactItem {
  /** What it is, in a word or two, and what tells it from the others: "As", "Method", "Into". */
  label: string;
  value: ReactNode;
}

/**
 * What a confirmation will do, as facts in two columns: the account it acts as, the method, the
 * branch it goes into, the revision it merges. Say each exactly, before anything happens.
 */
export function Facts({ items }: { items: readonly FactItem[] }) {
  return (
    <dl className="m-0 facts text-fg text-ui">
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt className="text-fg-muted">{item.label}</dt>
          <dd className="m-0 flex min-w-0 items-center gap-6">{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** A person as a fact states them: their picture's place, then their login. */
export function FactPerson({ login }: { login: string }) {
  return (
    <>
      <Avatar login={login} size="sm" />
      <span className="min-w-0 truncate">{withoutBidi(login)}</span>
    </>
  );
}
