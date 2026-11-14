import { describe, expect, it } from 'vitest';

import { excerptFrom, prepareFile, renderPost } from './index.ts';

const AT = {
  repo: { owner: 'rozed-dev', name: 'e2e' },
  page: 'https://github.com/rozed-dev/e2e/pull/23',
};

describe('renderPost', () => {
  it('draws the Markdown until GitHub’s HTML is there, with the repository’s references', () => {
    const { tree, images } = renderPost({ html: null, markdown: 'Fixes #7', ...AT });
    expect(JSON.stringify(tree)).toContain('https://github.com/rozed-dev/e2e/issues/7');
    expect(images).toBe(false);
  });

  it('draws GitHub’s HTML, and says when it shows an image', () => {
    const html =
      '<p>Before</p><p><a href="https://github.com/user-attachments/assets/1"><img src="https://github.com/user-attachments/assets/1" alt="shot"></a></p>';
    const { tree, images } = renderPost({ html, markdown: 'Before\n\n![shot](x)', ...AT });
    expect(JSON.stringify(tree)).toContain('Before');
    expect(images).toBe(true);
  });
});

/** An image's syntax, which says few words in many characters. */
const image = (index: number) =>
  `![shot ${index}](https://github.com/user-attachments/assets/${'a'.repeat(36)}) `;

/** A link's syntax, with an address far longer than its words. */
const link = (index: number) => `[link ${index}](https://example.com/${'p'.repeat(200)}) `;

describe('excerptFrom', () => {
  it('is a comment’s words on one line, with none of its Markdown’s syntax', () => {
    expect(excerptFrom('Fixture C:\n  Is   doubling\nenough?')).toBe(
      'Fixture C: Is doubling enough?',
    );
    expect(
      excerptFrom('**Bold**, _soft_ and ~~gone~~: use `retry()` or [the guide](https://x.dev/g).'),
    ).toBe('Bold, soft and gone: use retry() or the guide.');
    expect(excerptFrom('Looks like this ![a screenshot](https://x.dev/a.png) is stale.')).toBe(
      'Looks like this a screenshot is stale.',
    );
    expect(excerptFrom('# Heading\n\n- one\n- two\n\n> quoted')).toBe('Heading one two quoted');
  });

  it('shows what a code fence and a suggestion hold, not the fence', () => {
    const text = excerptFrom('Try this:\n```suggestion\nconst tries = 3;\n```\nThen run it.');
    expect(text).toBe('Try this: const tries = 3; Then run it.');
    expect(text).not.toContain('`');
    expect(text).not.toContain('suggestion');
    expect(excerptFrom('```ts\nlet x = 1;\n```')).toBe('let x = 1;');
  });

  it('shows the words of raw HTML, an image as its alt text or "image", and code as written', () => {
    expect(
      excerptFrom('<b>Heads up</b>: <details><summary>Stack trace</summary>\n\nat main</details>'),
    ).toBe('Heads up: Stack trace at main');
    expect(excerptFrom('Before <img width="9" src="a.png" alt="the chart"> after')).toBe(
      'Before the chart after',
    );
    expect(excerptFrom('<img src="a.png">')).toBe('image');
    expect(excerptFrom('Use `<div>` here.')).toBe('Use <div> here.');
  });

  it('shows text that is no HTML as GitHub shows it, with its less-than signs, escapes and entities', () => {
    expect(excerptFrom('if a<b then return')).toBe('if a<b then return');
    expect(excerptFrom('x<y here, and z>w')).toBe('x<y here, and z>w');
    expect(excerptFrom('&lt;b&gt;bold&lt;/b&gt; and \\<b\\>bold\\</b\\>')).toBe(
      '<b>bold</b> and <b>bold</b>',
    );
  });

  it('reads all of a comment before it cuts, so no half a link or an image is left', () => {
    // The words are far fewer than the syntax around them, and the cut falls inside the last one.
    const text = excerptFrom(Array.from({ length: 40 }, (_, index) => image(index)).join(''));
    expect(text.startsWith('shot 0 shot 1 shot 2')).toBe(true);
    expect(text).toHaveLength(120);
    expect(text.endsWith('…')).toBe(true);
    for (const syntax of ['![', '](', 'https:', 'user-attachments'])
      expect(text).not.toContain(syntax);
    expect(excerptFrom(Array.from({ length: 30 }, (_, index) => link(index)).join(''))).not.toMatch(
      /[[\]()]|https/,
    );
  });

  it('says a mention as it is written, and is empty for a comment with no words', () => {
    expect(excerptFrom('cc @mira-chen, see #7')).toBe('cc @mira-chen, see #7');
    expect(excerptFrom('  \n\n ')).toBe('');
  });

  it('cuts a long one short with an ellipsis, never through a character', () => {
    const cut = excerptFrom('word '.repeat(60));
    expect(cut).toHaveLength(120);
    expect(cut.endsWith('word…')).toBe(true);
    // A pair of surrogates straddling the cut goes whole or not at all.
    const emoji = excerptFrom('x'.repeat(118) + '😀😀😀');
    expect(emoji).toBe(`${'x'.repeat(118)}…`);
    expect(excerptFrom('x'.repeat(120))).toBe('x'.repeat(120));
  });
});

/** A 2×2 red PNG. */
const PNG = new Uint8Array(
  Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000001949444154780101' +
      '0e00f1ff00c81e1ec81e1e00c81e1ec81e1e1f260411ecbcd8e10000000049454e44ae426082',
    'hex',
  ),
);

describe('prepareFile', () => {
  it('checks a file as GitHub takes it, and answers the bytes to send in memory of their own', () => {
    const inside = new Uint8Array(PNG.length + 8);
    inside.set(PNG, 4);
    const prepared = prepareFile({ name: 'shot.png', bytes: inside.subarray(4, 4 + PNG.length) });
    expect(prepared).toMatchObject({
      kind: 'prepared',
      name: 'shot.png',
      size: `${PNG.length} bytes`,
      metadata: { kind: 'image' },
      paidPlan: false,
    });
    if (prepared.kind !== 'prepared') throw new Error('not prepared');
    expect(prepared.bytes.buffer.byteLength).toBe(prepared.bytes.byteLength);
    expect([...prepared.bytes]).toEqual([...PNG]);
  });

  it('says why it won’t attach a file, reading none of one too large to be anything', () => {
    expect(prepareFile({ name: 'notes.txt', bytes: new TextEncoder().encode('hi') })).toEqual({
      kind: 'refused',
      why: 'GitHub takes PNG, JPEG, GIF, WebP and SVG images and MP4, MOV and WebM videos',
    });
    expect(prepareFile({ name: 'notes.txt', bytes: null })).toMatchObject({ kind: 'refused' });
    expect(prepareFile({ name: 'demo.mov', bytes: null })).toEqual({
      kind: 'refused',
      why: "it's larger than GitHub's 100 MB",
    });
    expect(prepareFile({ name: 'shot.jpg', bytes: PNG })).toEqual({
      kind: 'refused',
      why: "its name says JPEG, but it isn't",
    });
  });
});
