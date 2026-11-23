import { showFormat } from './controls.ts';
import { ShownText } from './ShownText.tsx';

/**
 * Where an answer about code came from: a language server, by its name, or Lo's own reading of the
 * syntax. A peek, the references and a type hover all say it beside what they show.
 */
export type AnswerSource = { kind: 'server'; name: string } | { kind: 'syntax' };

/** The words that say a source: a server's name, or "Code index". */
export function sourceName(source: AnswerSource): string {
  return source.kind === 'server' ? source.name : 'Code index';
}

/**
 * A source as a dot and its name, with what sets this answer apart after it: "TypeScript",
 * "TypeScript · overload", "Code index · same name". A server's dot is green, since it answered;
 * the syntax index's is dim, as it's the fallback. The name always comes with the dot.
 */
export function SourceMark({
  source,
  note,
  wrap = false,
}: {
  source: AnswerSource;
  note?: string | undefined;
  /**
   * Let a long note run onto more lines, as one in a narrow column must, instead of cutting it off
   * with an ellipsis.
   */
  wrap?: boolean;
}) {
  return (
    <span
      className={
        wrap
          ? 'flex min-w-0 items-baseline gap-6'
          : 'inline-flex min-w-0 items-baseline gap-6 whitespace-nowrap'
      }
    >
      <span
        className={`size-6 flex-none rounded-full ${source.kind === 'server' ? 'bg-success' : 'bg-fg-dim'}`}
        aria-hidden="true"
      />
      <span className={wrap ? 'min-w-0 wrap-anywhere' : 'min-w-0 truncate'}>
        <ShownText text={sourceName(source)} />
        {note !== undefined && (
          <>
            {' · '}
            <ShownText text={note} />
          </>
        )}
      </span>
    </span>
  );
}

/**
 * A path with its file's name standing out from the folders before it. When the row is too narrow,
 * the folders give way first, so the name is always there to read.
 */
export function PathName({ path, strong = false }: { path: string; strong?: boolean }) {
  const at = path.lastIndexOf('/');
  return (
    <span className="flex min-w-0 items-baseline" title={showFormat(path)}>
      <span className="min-w-0 truncate">
        <ShownText text={path.slice(0, at + 1)} />
      </span>
      <span className={`flex-none ${strong ? 'font-semibold' : 'text-fg'}`}>
        <ShownText text={path.slice(at + 1)} />
      </span>
    </span>
  );
}
