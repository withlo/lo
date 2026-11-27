import { Fragment } from 'react';

/**
 * A path drawn whole, as code. Where it's wider than its line, it wraps only after a `/`: never at a
 * hyphen, a dot or a space in a name, so `lo-trees` and `Application Support` stay whole. A single
 * name longer than the line wraps anywhere in it. Copied, it's the path as written.
 */
export function WholePath({ path, className }: { path: string; className?: string | undefined }) {
  // Each name with the slash after it, as a box that's as wide as the line at most.
  const names = path.split(/(?<=\/)/);
  return (
    <code className={className}>
      {names.map((name, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          <span className="inline-block max-w-full break-all">{name}</span>
        </Fragment>
      ))}
    </code>
  );
}
