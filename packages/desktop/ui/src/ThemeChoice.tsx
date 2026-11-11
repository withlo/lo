import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';

/** The themes Lo can wear: its dark one, its light one, or whichever the system is in. */
export type ThemeName = 'dark' | 'light' | 'system';

/** A theme's swatch: the chrome beside the ground, painted with that theme's own colors. */
function Swatch({ theme }: { theme: ThemeName }): ReactNode {
  if (theme === 'system') {
    // Half of each, side by side.
    return (
      <div className="flex h-swatch-h w-swatch-w overflow-hidden rounded-sm border border-border">
        <i data-theme="dark" className="block flex-1 bg-bg" />
        <i data-theme="light" className="block flex-1 bg-bg" />
      </div>
    );
  }
  return (
    <div
      data-theme={theme}
      className="flex h-swatch-h w-swatch-w overflow-hidden rounded-sm border border-border"
    >
      <i className="block w-1/3 bg-bg-chrome" />
      <i className="block flex-1 bg-bg" />
    </div>
  );
}

const choices: readonly { theme: ThemeName; label: string }[] = [
  { theme: 'dark', label: 'Dark' },
  { theme: 'light', label: 'Light' },
  { theme: 'system', label: 'Match the system' },
];

export interface ThemeChoiceProps {
  value: ThemeName;
  onChange: (theme: ThemeName) => void;
}

/**
 * Which theme Lo wears, as three cards that each show it. A radio group: arrow keys move between
 * the cards, and the one chosen has the accent around it.
 */
export function ThemeChoice({ value, onChange }: ThemeChoiceProps) {
  return (
    <RadioGroup
      aria-label="Theme"
      value={value}
      onValueChange={(next: ThemeName) => onChange(next)}
      className="flex gap-12"
    >
      {choices.map(({ theme, label }) => (
        <Radio.Root
          key={theme}
          value={theme}
          className="flex flex-col gap-8 rounded-md border border-border p-8 text-fg text-small focus-visible:shadow-ring data-checked:border-accent data-checked:bg-accent-soft"
        >
          <Swatch theme={theme} />
          <span>{label}</span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
