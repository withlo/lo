import { Switch as Base } from '@base-ui/react/switch';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  /** What it turns on, for screen readers, when no label names it. */
  'aria-label'?: string | undefined;
  'aria-describedby'?: string | undefined;
}

/**
 * An on-off control for something that stays changed, beside its label: a setting, or which
 * accounts to import. `Space` turns it. Its thumb slides across and its track changes color: the
 * Slide and Tint moves. Off, its track keeps an outline that shows on any surface, and disabled, a
 * dimmer one: it's a switch whatever its state.
 */
export function Switch({ checked, onCheckedChange, disabled, ...aria }: SwitchProps) {
  return (
    <Base.Root
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      disabled={disabled}
      {...aria}
      className="flex h-16 w-switch-w flex-none items-center rounded-pill bg-bg-element-press p-2 inset-ring inset-ring-fg-dim move-tint focus-visible:shadow-ring data-checked:bg-accent data-checked:inset-ring-transparent data-disabled:bg-bg-element data-disabled:data-checked:inset-ring-border-strong data-disabled:data-unchecked:inset-ring-border-strong"
    >
      <Base.Thumb className="size-12 rounded-pill bg-fg move-slide data-checked:switch-on data-checked:bg-on-accent data-disabled:bg-fg-disabled" />
    </Base.Root>
  );
}
