// For tests of the row: the sizes the design system's stylesheet sets on the page, which the row
// reads its panels' widths and the view's minimum from.

/** Sets the row's sizes on the page, as the stylesheet does. */
export function setRowSizes(): void {
  const sizes = {
    'panel-left-w': '300px',
    'panel-left-min-w': '220px',
    'panel-left-max-w': '480px',
    'panel-right-w': '340px',
    'panel-right-min-w': '280px',
    'panel-right-max-w': '560px',
    'view-min-w': '340px',
    'timeline-w': '856px',
    'sp-24': '24px',
    'splitter-w': '8px',
  };
  for (const [name, value] of Object.entries(sizes)) {
    document.documentElement.style.setProperty(`--lo-${name}`, value);
  }
}
