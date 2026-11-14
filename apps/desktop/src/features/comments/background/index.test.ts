import { describe, expect, it } from 'vitest';

import { prepareFile, renderPost } from './index.ts';

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
