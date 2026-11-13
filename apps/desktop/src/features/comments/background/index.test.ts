import { describe, expect, it } from 'vitest';

import { renderPost } from './index.ts';

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
