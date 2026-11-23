import { withoutBidi } from './controls.ts';
import { Tooltip } from './Tooltip.tsx';

export interface BranchProps {
  /** The branch's name, as GitHub has it. */
  name: string;
  /** The branch a pull request merges into, a step quieter than the one it merges from. */
  base?: boolean | undefined;
}

/**
 * A branch's name, in code type, cut short with its whole name as its tooltip while it's cut. A
 * name is the pull request author's text, so it's drawn without the characters that turn text
 * around.
 */
export function Branch({ name, base = false }: BranchProps) {
  const shown = withoutBidi(name);
  return (
    <Tooltip label={shown} cut>
      <span
        className={`lo-selectable inline-block h-20 max-w-tab-w min-w-0 truncate rounded-xs bg-hover px-6 code-small ${base ? 'text-fg-muted' : 'text-fg'}`}
      >
        {shown}
      </span>
    </Tooltip>
  );
}
