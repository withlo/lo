/**
 * The rules every node is built under, whatever text it came from: where links go, which images
 * load, and the limits on images and addresses. Markdown's mapping and GitHub's HTML's both build
 * through one `Builder`, so the two can't disagree.
 */

import { Anchors } from './anchors.ts';
import { imageAddress } from './images.ts';
import { MAX_ADDRESS, MAX_DIAGNOSTICS, type Limits } from './limits.ts';
import { fragmentName, webLink } from './links.ts';
import { isLogin } from './references.ts';
import type { Diagnostic, Extension, Inline, Note, Plain, Target } from './tree.ts';

/** What building has used up, to put back when what was built is thrown away. */
export interface Snapshot {
  images: number;
  addresses: number;
  diagnostics: number;
}

export class Builder<X extends Extension = Plain> {
  readonly diagnostics: Diagnostic[] = [];
  readonly anchors = new Anchors();
  readonly limits: Limits;
  readonly notes: Set<Note>;
  /** What a footnote reference shows when its footnote isn't in the tree, by the footnote's name. */
  readonly references = new Map<string, string>();
  /** The line being built, from 1, when the source has lines. */
  line: number | undefined;
  private readonly page: string | undefined;
  private readonly claim: ((href: string) => X['target'] | undefined) | undefined;
  private images = 0;
  private addresses = 0;

  constructor(
    limits: Limits,
    notes: Set<Note>,
    page: string | undefined,
    claim?: (href: string) => X['target'] | undefined,
  ) {
    this.limits = limits;
    this.notes = notes;
    this.page = page;
    this.claim = claim;
  }

  snapshot(): Snapshot {
    return {
      images: this.images,
      addresses: this.addresses,
      diagnostics: this.diagnostics.length,
    };
  }

  restore(snapshot: Snapshot): void {
    this.images = snapshot.images;
    this.addresses = snapshot.addresses;
    this.diagnostics.length = snapshot.diagnostics;
  }

  diagnose(code: Diagnostic['code']): void {
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) return;
    this.diagnostics.push(this.line === undefined ? { code } : { code, line: this.line });
  }

  /** A link to `href` holding `children`, or the children alone when Lo won't follow it. */
  link(href: unknown, children: Inline<X>[]): Inline<X>[] {
    const target = typeof href === 'string' ? this.target(href) : undefined;
    if (target) return [{ kind: 'link', target, children }];
    this.diagnose('link');
    return children;
  }

  /** Where a link to `href` goes, or undefined when Lo won't follow it. */
  target(href: string): Target<X> | undefined {
    const claimed = this.claim?.(href);
    if (claimed) return claimed;
    const name = fragmentName(href);
    if (name !== undefined && this.anchors.has(name)) {
      const charged = this.address(href, () => name);
      return charged === undefined ? undefined : { kind: 'anchor', name: charged };
    }
    const url = this.address(href, (address) => webLink(address, this.page));
    return url === undefined ? undefined : { kind: 'web', url };
  }

  /**
   * An image from `src`, or when Lo won't load it, a link to where it is by its alt text (unless
   * `linked`, inside a link already, where another can't go), or the alt text alone.
   */
  image(src: unknown, alt: string, linked: boolean): Inline<X>[] {
    if (typeof src !== 'string') return alt === '' ? [] : [{ kind: 'text', value: alt }];
    if (this.images < this.limits.images) {
      const url = this.address(src, (address) => imageAddress(address, this.page));
      if (url !== undefined) {
        this.images += 1;
        return [{ kind: 'image', url, alt }];
      }
      this.diagnose('image');
    }
    const url = linked ? undefined : this.address(src, (address) => webLink(address, this.page));
    if (url !== undefined) {
      const label = alt === '' ? url : alt;
      return [
        { kind: 'link', target: { kind: 'web', url }, children: [{ kind: 'text', value: label }] },
      ];
    }
    return alt === '' ? [] : [{ kind: 'text', value: alt }];
  }

  /**
   * A mention of `name`, a login or `org/team`, linked to its page on GitHub, or `written` as
   * text when the name isn't one GitHub allows or the limit on addresses is spent.
   */
  mention(name: string, written: string): Inline<X>[] {
    const [login, team, ...more] = name.split('/');
    const valid =
      login !== undefined &&
      isLogin(login) &&
      more.length === 0 &&
      (team === undefined || /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(team));
    const page =
      team === undefined
        ? `https://github.com/${login}`
        : `https://github.com/orgs/${login}/teams/${team}`;
    const url = valid ? this.address(page, (address) => webLink(address)) : undefined;
    return url === undefined
      ? [{ kind: 'text', value: written }]
      : [{ kind: 'mention', name, url }];
  }

  /**
   * `read(href)`, charged against the limit on addresses, or undefined when it's refused or the
   * limit is spent. An address too long to keep isn't read at all, so a huge one named by
   * reference over and over costs nothing.
   */
  address(href: string, read: (href: string) => string | undefined): string | undefined {
    if (href.length > MAX_ADDRESS) return undefined;
    const url = read(href);
    // Normalizing can lengthen an address, so the limits hold for what's kept.
    if (url === undefined || url.length > MAX_ADDRESS) return undefined;
    if (this.addresses + url.length > this.limits.addresses) return undefined;
    this.addresses += url.length;
    return url;
  }
}
