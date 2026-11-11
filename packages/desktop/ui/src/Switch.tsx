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
 * accounts to import. `Space` turns it.
 */
export function Switch({ checked, onCheckedChange, disabled, ...aria }: SwitchProps) {
  return (
    <Base.Root
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      disabled={disabled}
      {...aria}
      className="flex h-16 w-switch-w flex-none items-center justify-start rounded-pill bg-bg-element-press p-2 focus-visible:shadow-ring data-checked:justify-end data-checked:bg-accent data-disabled:bg-bg-element"
    >
      <Base.Thumb className="size-12 rounded-pill bg-fg data-checked:bg-on-accent data-disabled:bg-fg-disabled" />
    </Base.Root>
  );
}
