import { Button } from './Button.tsx';
import { Key } from './Key.tsx';
import { Tooltip } from './Tooltip.tsx';

/** A layer shown, as the bar names it. */
export interface RunBarLayer {
  readonly number: number;
  /** Its title, as text. */
  readonly title?: string | undefined;
}

export interface RunBarProps {
  /** The layers shown, bottom first. */
  layers: readonly RunBarLayer[];
  /** What they're called, by their span in the stack: "Layers 3–5". */
  name: string;
  /**
   * The branch its diff starts from, under its bottom layer, and the one it ends at, its top's.
   * Left out while `problem` is, since they don't describe what's on screen.
   */
  branches?: { readonly from: string; readonly to: string } | undefined;
  /**
   * How many files its diff changes, once that's known, with whether more were left out. Left out
   * while `problem` is, for the same reason.
   */
  files?: { readonly count: number; readonly partial?: boolean | undefined } | undefined;
  /**
   * Why the layers don't show as one diff, and what shows instead, when GitHub couldn't compare
   * them: said in place of their name and titles, and with neither the branches nor the file
   * count, which describe the diff that isn't on screen.
   */
  problem?: { readonly title: string; readonly reason: string } | undefined;
  /** The button's words: its command's label. */
  backLabel?: string | undefined;
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
 * The bar across the top of the middle while several of a stack's layers are on screen as one diff:
 * which layers, or why they couldn't be compared and what shows instead, the branches the diff goes
 * between, how many files it changes, and the way back to a single layer. A pull request's text is
 * drawn as text; the key and what the button does belong to the caller.
 *
 * The count of files is never cut short. The branches are the first to go: a bar under 1,000 px
 * wide, as the window's default is, leaves them out rather than cutting the layers' names, or the
 * count, short for them. The line of text may still be cut, so its title says all of it.
 */
export function RunBar({
  layers,
  name,
  branches,
  files,
  problem,
  backLabel = 'Show single layer',
  backKeys,
  onBack,
}: RunBarProps) {
  const which = listed(layers.map(named));
  const said = problem ? `${problem.title} · ${problem.reason}` : `${name} · ${which}`;
  // What's on screen isn't their diff, so neither is where it goes between nor how many files.
  const between = problem === undefined ? branches : undefined;
  const count = problem === undefined ? files : undefined;
  return (
    <div
      role="region"
      aria-label={name}
      className="@container flex min-w-0 flex-none items-center gap-12 border-b border-accent-line bg-accent-soft py-4 ps-16 pe-8 text-fg text-ui"
    >
      <svg className="lo-i flex-none text-fg-accent" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.25 13.75 5 8 7.75 2.25 5Z" />
        <path d="M2.25 8 8 10.75 13.75 8M2.25 11 8 13.75 13.75 11" />
      </svg>
      <Tooltip label={said} cut>
        <p className="min-w-0 truncate" role={problem ? 'alert' : undefined}>
          <strong className="font-semibold">{problem?.title ?? name}</strong>{' '}
          {problem ? problem.reason : `· ${which}`}
        </p>
      </Tooltip>
      {(between !== undefined || count !== undefined) && (
        <span className="flex items-center gap-6 text-fg-muted code-small">
          {between !== undefined && (
            <span className="run-branches min-w-0 truncate">
              {between.from} → {between.to}
              {count !== undefined && ' · '}
            </span>
          )}
          {count !== undefined && <span className="whitespace-nowrap">{fileCount(count)}</span>}
        </span>
      )}
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={onBack}>
        {backLabel}
        {backKeys !== undefined && <Key keys={backKeys} decorative />}
      </Button>
    </div>
  );
}
