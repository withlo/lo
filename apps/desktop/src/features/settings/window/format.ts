// Sizes as a person types them into Settings.

/**
 * The whole number of GB in `text` a person typed, or none: digits only, so `1e3`, `2.5`, `-4`,
 * `0x10` and an empty field are all not numbers of GB.
 */
export function wholeNumber(text: string): number | undefined {
  const trimmed = text.trim();
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : undefined;
}
