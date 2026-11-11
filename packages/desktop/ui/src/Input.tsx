import { cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';

const input = cva(
  'h-control-h w-full min-w-0 rounded-sm border bg-bg-well px-8 text-fg placeholder:text-fg-subtle hover:border-border-strong focus-visible:shadow-ring',
  {
    variants: {
      mono: { true: 'code-text', false: 'text-ui' },
      invalid: { true: 'border-danger-border', false: 'border-border' },
    },
    defaultVariants: { mono: false, invalid: false },
  },
);

export interface InputProps extends Omit<ComponentProps<'input'>, 'className'> {
  /** For links, paths and numbers. */
  mono?: boolean | undefined;
  /** What it holds can't be used. Say why under the field, and tie that to it with `aria-describedby`. */
  invalid?: boolean | undefined;
}

/**
 * A one-line text field set into chrome. Give it a label of its own (`aria-label`, or a label that
 * names it), never only a placeholder. Multi-line text is a comment box, not an input.
 */
export function Input({ mono, invalid, ...props }: InputProps) {
  return (
    <input
      className={input({ mono, invalid })}
      aria-invalid={invalid ? true : undefined}
      {...props}
    />
  );
}
