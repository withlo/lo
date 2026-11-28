// A stack overview's Layers section: Lo's own list of the stack's layers, drawn live from the stack
// as its tree draws it, with the tree's rails and balls. Each layer is a button that shows it: its
// title, number and state, then what its overview's tl;dr says, or its description's first line.

import { cva } from 'class-variance-authority';

import { Swap } from '../Collapse.tsx';
import { withoutBidi } from '../controls.ts';
import { Icon } from '../Icon.tsx';
import { Skeleton } from '../Spinner.tsx';
import {
  FINISHED,
  rail,
  railsOf,
  REVIEWS,
  type StackReview,
  type StackTreeLayer,
} from '../StackTree.tsx';
import { STATE_ICONS } from '../StatePill.tsx';

/**
 * What a layer's row says under its title: its overview's tl;dr as text, three lines at most; else
 * its description's first line; else that it has neither. While its overview is read, a skeleton.
 */
export type LayerSummary =
  | { kind: 'tldr'; text: string }
  | { kind: 'description'; text: string }
  | { kind: 'none' }
  | { kind: 'reading' };

/** One layer of the stack, as its row in a stack overview shows it. */
export interface StackLayer extends Pick<
  StackTreeLayer,
  'key' | 'number' | 'title' | 'state' | 'branch' | 'sitsOn'
> {
  /** Shown for an open layer; any other says its state in its place ("Draft", "Merged"). */
  review?: StackReview | undefined;
  summary: LayerSummary;
}

export interface StackLayersProps {
  /** The layers in the order the stack's tree draws them: the bottom first, each branch in turn. */
  layers: readonly StackLayer[];
  /** The layer in the pull request's header, by key: its ball is Powder. */
  current?: string | undefined;
  /** A layer was clicked, or `⏎` pressed on it: show it, as `stacks.show` does. */
  onShow?: ((key: string) => void) | undefined;
}

const row = cva(
  'stack-layer min-w-0 flex-1 cursor-default text-start move-tint hover:bg-hover focus-visible:shadow-ring-inset',
  {
    variants: {
      branch: { true: 'stack-branch', false: '' },
      sprout: { true: 'stack-sprout', false: '' },
      trunk: { true: 'stack-trunk', false: '' },
    },
  },
);

/** What a layer's state says after its number: a finished layer's or a draft's, or its review. */
function State({ layer }: { layer: StackLayer }) {
  const finished = FINISHED[layer.state];
  if (finished !== undefined) {
    return (
      <span className={`stack-layers-state whitespace-nowrap text-small ${finished.tone}`}>
        <span className="me-4 inline-flex align-middle">
          <Icon name={STATE_ICONS[layer.state]} size={12} />
        </span>
        {finished.word}
      </span>
    );
  }
  if (layer.review === undefined) return null;
  const review = REVIEWS[layer.review];
  return (
    <span className={`stack-layers-state whitespace-nowrap text-small ${review.tone}`}>
      {review.word}
    </span>
  );
}

/** What a layer's row says under its title, in `read-comment` and `lo-fg-muted`. */
function Summary({ summary }: { summary: LayerSummary }) {
  switch (summary.kind) {
    case 'tldr':
      return (
        <span className="line-clamp-3 text-fg-muted read-comment">{withoutBidi(summary.text)}</span>
      );
    case 'description':
      return (
        <span className="block truncate text-fg-muted read-comment">
          {withoutBidi(summary.text)}
        </span>
      );
    case 'none':
      return <span className="block text-fg-subtle read-comment">No description</span>;
    case 'reading':
      return (
        <span className="flex h-1lh items-center read-comment">
          <Skeleton className="w-3/5" />
        </span>
      );
    default:
      summary satisfies never;
      return null;
  }
}

/**
 * The stack's layers, a row each, at the measure: the rail and ball in a 20 px column (Powder on
 * the layer in the header), the title in `text-ui` 600, its number, its state, and under them its
 * summary. Each row is a button and a stop for `Tab`; a click or `⏎` shows the layer. It draws what
 * it's given, as text.
 */
export function StackLayers({ layers, current, onShow }: StackLayersProps) {
  const rails = railsOf(layers);
  return (
    <div className="stack-layers" role="list" aria-label="Layers">
      {layers.map((layer, index) => {
        const shape = rails[index];
        const onScreen = layer.key === current;
        return (
          <div key={layer.key} role="listitem" className="flex">
            <button
              type="button"
              aria-current={onScreen ? 'true' : undefined}
              data-key={layer.key}
              data-state={layer.state}
              className={row({
                branch: shape?.branch ?? false,
                sprout: shape?.sprout ?? false,
                trunk: shape?.trunk ?? false,
              })}
              onClick={() => onShow?.(layer.key)}
            >
              <span
                aria-hidden="true"
                className={rail({
                  // The bottom layer's rail starts at its ball: nothing's drawn below the list.
                  sprout: (shape?.sprout ?? false) || index === 0,
                  last: shape?.last ?? true,
                  ball:
                    layer.state === 'merged'
                      ? 'merged'
                      : layer.state === 'closed'
                        ? 'closed'
                        : onScreen
                          ? 'current'
                          : 'rest',
                })}
              />
              <span className="flex min-w-0 flex-col gap-2 wrap-anywhere">
                <span className="text-ui">
                  <span className="text-fg text-ui-strong">{withoutBidi(layer.title)}</span>
                  <span className="lo-num ms-8 text-fg-muted">#{layer.number}</span>
                  <State layer={layer} />
                </span>
                <Swap id={layer.summary.kind === 'reading' ? 'reading' : 'summary'}>
                  <Summary summary={layer.summary} />
                </Swap>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
