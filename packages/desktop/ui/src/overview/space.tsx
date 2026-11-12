// The room an excerpt takes before it's drawn, drawn as an excerpt is: the same classes, so the
// code views' own rules give it its line height and padding, and it's exactly as tall as an excerpt
// of as many lines that don't wrap.

/** An excerpt's frame holding `rows` empty lines, for room, which nobody reads or reaches. */
export function ExcerptSpace({ rows }: { rows: number }) {
  return (
    <div className="lo-excerpt" aria-hidden="true">
      <div className="cm-editor">
        <div className="cm-scroller">
          <div className="cm-content">
            {Array.from({ length: Math.max(0, rows) }, (_, index) => (
              <div key={index} className="cm-line">
                <br />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
