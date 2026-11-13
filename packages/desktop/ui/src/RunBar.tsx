import { Button } from './Button.tsx';
import { Key } from './Key.tsx';

/** A layer of a run, as the bar names it. */
export interface RunBarLayer {
  readonly number: number;
  /** Its title, as text. */
  readonly title?: string | undefined;
}

export interface RunBarProps {
  /** The run's layers, bottom first. */
  layers: readonly RunBarLayer[];
  /** The branch its diff starts from, under its bottom layer, and the one it ends at, its top's. */
  branches?: { readonly from: string; readonly to: string } | undefined;
  /** How many files its diff changes, once that's known, with whether more were left out. */
  files?: { readonly count: number; readonly partial?: boolean | undefined } | undefined;
  /**
   * What shows instead of the run's diff, in words, when it couldn't be compared as one: said in
   * place of how many layers it holds, which isn't what's on screen.
   */
  instead?: string | undefined;
  /** The layer the button goes back to: the one the run was chosen from. */
  back: number;
  /** The button's key, as the system shows it, if it has one. */
  backKeys?: readonly string[] | undefined;
  onBack: () => void;
}

/** "#4819 Load per-plan limits", or "#4819" while its title isn't known. */
function named({ number, title }: RunBarLayer): string {
  return title === undefined || title === '' ? `#${number}` : `#${number} ${title}`;
}

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/** "245 files", "1 file", "300+ files". */
function fileCount({ count, partial }: NonNullable<RunBarProps['files']>): string {
  return `${count.toLocaleString('en-US')}${partial ? '+' : ''} ${count === 1 && !partial ? 'file' : 'files'}`;
}

/**
 * The bar across the top of the middle while a run of a stack's layers is on screen as one diff:
 * how many layers and which, or what shows instead when it couldn't be compared, the branches the
 * diff goes between, how many files it changes, and the way back to the layer the run was chosen
 * from. A pull request's text is drawn as text; the key
 * and what the button does belong to the caller.
 */
export function RunBar({ layers, branches, files, instead, back, backKeys, onBack }: RunBarProps) {
  const which = listed(layers.map(named));
  return (
    <div
      role="region"
      aria-label="Run of layers"
      className="flex min-w-0 flex-none items-center gap-12 border-b border-accent-line bg-accent-soft py-4 ps-16 pe-8 text-fg text-ui"
    >
      <svg className="lo-i flex-none text-fg-accent" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.25 13.75 5 8 7.75 2.25 5Z" />
        <path d="M2.25 8 8 10.75 13.75 8M2.25 11 8 13.75 13.75 11" />
      </svg>
      <p className="min-w-0 truncate" title={which}>
        <strong className="font-semibold">
          {instead ?? `${layers.length} layers as one diff`}
        </strong>{' '}
        · {which}
      </p>
      {(branches !== undefined || files !== undefined) && (
        <span className="min-w-0 truncate text-fg-muted code-small">
          {branches !== undefined && `${branches.from} → ${branches.to}`}
          {branches !== undefined && files !== undefined && ' · '}
          {files !== undefined && fileCount(files)}
        </span>
      )}
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={onBack}>
        Back to #{back}
        {backKeys !== undefined && <Key keys={backKeys} decorative />}
      </Button>
    </div>
  );
}
