# Figures in overviews

The contract for agents that draw figures for an overview. Lo shows a figure's SVG inside a frame it
styles, and defines seventeen named colors on that frame, so the same file follows the reader's
light or dark theme. The overview skill should link to this file.

## The colors

Roles, for most of a figure:

| Name          | Use                                                                 |
| ------------- | ------------------------------------------------------------------- |
| `--fig-paper` | The figure's ground. Lo draws it; leave the SVG's background empty. |
| `--fig-panel` | Fill of neutral boxes.                                              |
| `--fig-ink`   | Primary text and strokes.                                           |
| `--fig-muted` | Secondary text, labels on arrows, leader lines.                     |
| `--fig-line`  | Hairlines, grids, box outlines.                                     |

Hues, each with a `-soft` fill to put under it:

| Name                                | Means                                               |
| ----------------------------------- | --------------------------------------------------- |
| `--fig-blue`, `--fig-blue-soft`     | What this PR adds or changes. The figure's subject. |
| `--fig-green`, `--fig-green-soft`   | Added, allowed, passing.                            |
| `--fig-amber`, `--fig-amber-soft`   | Changed, waiting, a warning.                        |
| `--fig-red`, `--fig-red-soft`       | Removed, refused, failing.                          |
| `--fig-aqua`, `--fig-aqua-soft`     | A neutral category.                                 |
| `--fig-violet`, `--fig-violet-soft` | A second neutral category.                          |

The values for both themes are in `tokens.json`. Text in a hue reads at 4.5:1 on `--fig-paper`,
`--fig-panel` and that hue's own `-soft` fill, in both themes.

## Rules

- **Fill and stroke only with `var(--fig-*)`.** Any other color is drawn as written and won't follow
  the theme; the checker reports it.
- **Hues carry meaning.** Use blue for the thing the PR changes, and green, amber and red only for
  what they mean above. Use aqua and violet when you need categories with no judgment attached. Five
  hues in one figure is too many.
- **Put text on paper, panel or a `-soft` fill,** in `--fig-ink`, `--fig-muted` or the fill's own
  hue.
- **Type.** Leave `font-family` unset for text; Lo sets Host Grotesk. Use `font-family="monospace"`
  for code, paths and identifiers; Lo maps it to Fragment Mono. Nothing smaller than 11 px at the
  figure's drawn width.
- **Size.** Draw on a viewBox about 860 wide; Lo scales the figure to the article's width (up to 840
  px). Keep figures under about 320 tall.
- **Link parts by id.** Give each part that points at code, a term or a section an `id`, and link it
  the way the artifact format describes. Lo wraps the part, draws its hover and focus states and
  shows a preview. Don't draw your own hover styles.
- **No scripts, no external images, no `<foreignObject>`, no filters or gradients.** A figure that
  has them is left out, with a note in its place.
- **Always write a caption** that says what the figure shows, in one or two sentences.

## Example

```svg
<svg viewBox="0 0 860 120" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="24" width="126" height="60" rx="10" fill="var(--fig-panel)" stroke="var(--fig-line)"/>
  <text x="14" y="50" fill="var(--fig-ink)" font-weight="600">Request</text>
  <path d="M126 54h20" stroke="var(--fig-muted)" stroke-width="1.5"/>
  <rect x="146" y="24" width="126" height="60" rx="10" fill="var(--fig-blue-soft)" stroke="var(--fig-blue)"/>
  <text x="160" y="50" fill="var(--fig-ink)" font-weight="600">Estimate cost</text>
  <text x="160" y="68" fill="var(--fig-blue)" font-family="monospace" font-size="11">cost/analyzer.ts</text>
</svg>
```
