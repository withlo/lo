import { useState } from 'react';

import { Icon, type IconName } from './Icon.tsx';
import { label } from '../text/label.ts';

export const SIZES = ['small', 'large'] as const;

export interface BadgeProps {
  icon: IconName;
  count: number;
}

export function Badge({ icon, count }: BadgeProps) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen(!open)}>
      <Icon name={icon} />
      <span>{label(count)}</span>
      {open && <Badge.Details count={count} />}
    </button>
  );
}

Badge.Details = function Details({ count }: { count: number }) {
  return <p>{count}</p>;
};
