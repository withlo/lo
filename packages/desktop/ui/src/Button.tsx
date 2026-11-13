import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

const button = cva(
  'inline-flex flex-none items-center justify-center rounded-sm border whitespace-nowrap focus-visible:shadow-ring disabled:border-transparent disabled:bg-transparent disabled:text-fg-disabled aria-disabled:border-transparent aria-disabled:bg-transparent aria-disabled:text-fg-disabled',
  {
    variants: {
      variant: {
        secondary:
          'border-border-strong bg-bg-element text-fg hover:bg-bg-element-hover active:bg-bg-element-press',
        // The one main action in a view.
        primary:
          'border-transparent bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press',
        // In toolbars and headers, where a border would be noise. A toggle's is pressed while on.
        ghost:
          'border-transparent bg-transparent text-fg-muted hover:bg-hover hover:text-fg aria-pressed:bg-selected aria-pressed:text-fg',
        // Destructive or refusing.
        danger: 'border-danger-border bg-danger-bg text-danger',
      },
      size: {
        md: 'h-control-h gap-6 px-12',
        sm: 'h-control-h-sm gap-4 px-8',
      },
      icon: {
        true: 'px-0',
        false: '',
      },
    },
    compoundVariants: [
      { size: 'md', icon: true, class: 'w-control-h' },
      { size: 'sm', icon: true, class: 'w-control-h-sm' },
      { size: 'md', variant: 'primary', class: 'text-ui-strong' },
      { size: 'md', variant: ['secondary', 'ghost', 'danger'], class: 'text-ui-medium' },
      { size: 'sm', class: 'text-small-medium' },
    ],
    defaultVariants: { variant: 'secondary', size: 'md', icon: false },
  },
);

export interface ButtonProps
  extends Omit<ComponentProps<'button'>, 'className'>, Omit<VariantProps<typeof button>, 'icon'> {
  /** A square button holding an icon alone. Give it an `aria-label`. */
  icon?: boolean | undefined;
}

/**
 * A control that does one thing. Its label starts with a verb that says exactly what happens, and
 * a key it has goes inside it (`<Key keys={['⌘⏎']} />`). One `primary` button in a view at most.
 */
export function Button({ variant, size, icon, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={button({ variant, size, icon })} {...props} />;
}
