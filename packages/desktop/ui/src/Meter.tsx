import { Meter as BaseMeter } from '@base-ui/react/meter';

export interface MeterProps {
  /** How much, from 0 to `max`. */
  value: number;
  max: number;
  /** What it measures, for screen readers: the bar says nothing in words. */
  label: string;
}

/** How full something is, as a thin bar. Say the numbers in words beside it. */
export function Meter({ value, max, label }: MeterProps) {
  return (
    <BaseMeter.Root value={Math.min(value, max)} min={0} max={max} aria-label={label}>
      <BaseMeter.Track className="h-6 overflow-hidden rounded-pill bg-press">
        <BaseMeter.Indicator className="h-full rounded-pill bg-accent" />
      </BaseMeter.Track>
    </BaseMeter.Root>
  );
}
