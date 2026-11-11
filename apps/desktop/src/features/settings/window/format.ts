// Sizes as Settings writes them.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * A size in bytes as a person reads it, in the binary units the cache counts in: `512 B`, `38 KB`,
 * `6.2 GB`. A size under a KB is whole bytes, a KB whole, and bigger sizes have one decimal unless
 * it would be a zero.
 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const name = UNITS[unit];
  if (unit < 2) return `${Math.round(value)} ${name}`;
  return `${value.toFixed(1).replace(/\.0$/, '')} ${name}`;
}

/**
 * The whole number of GB in `text` a person typed, or none: digits only, so `1e3`, `2.5`, `-4`,
 * `0x10` and an empty field are all not numbers of GB.
 */
export function wholeNumber(text: string): number | undefined {
  const trimmed = text.trim();
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : undefined;
}
