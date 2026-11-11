/**
 * The names a document's headings and footnotes go by, made as GitHub makes them, so a link to
 * `#a-heading` written for GitHub finds its heading in Lo too.
 */
export class Anchors {
  private readonly taken = new Set<string>();
  /** How many times each slug has been taken, so a repeat finds its suffix without counting up. */
  private readonly repeats = new Map<string, number>();

  /** Takes `name` as it is, for a footnote. */
  reserve(name: string): void {
    this.taken.add(name);
  }

  /** A unique name for a heading whose text is `text`: GitHub's slug, `-1`, `-2` and on for repeats. */
  heading(text: string): string {
    const base = slug(text);
    let name = base;
    let count = this.repeats.get(base) ?? 0;
    while (this.taken.has(name)) {
      count += 1;
      name = `${base}-${count}`;
    }
    this.repeats.set(base, count);
    this.taken.add(name);
    return name;
  }

  has(name: string): boolean {
    return this.taken.has(name);
  }
}

/** GitHub's slug for a heading: lower case, punctuation and symbols removed, spaces as hyphens. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replaceAll(' ', '-');
}
