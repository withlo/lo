// The code's typeface, loaded before code is drawn where its height counts: lines laid out in a
// stand-in face, as the window does until the face is in, can stand taller than their line height,
// and a block measured then would change height once the face comes.

/** The code's typeface loading, once for the window. */
let loading: Promise<void> | undefined;

/**
 * Settles once the code's typeface, upright and italic, is in, or can't be: at once where the
 * window has no typefaces to load, as in tests.
 */
export function codeTypeface(): Promise<void> {
  loading ??= load();
  return loading;
}

async function load(): Promise<void> {
  const face = getComputedStyle(document.documentElement).getPropertyValue('--lo-font-mono').trim();
  if (face === '') return;
  await Promise.all(
    ['', 'italic '].map((style) => document.fonts?.load(`${style}1em ${face}`)),
  ).catch(() => undefined);
}
