// The page the comment box's spec drives: a line's box, as wide as the spec makes it, with every
// control its foot can hold.

import { createRoot } from 'react-dom/client';

import { CommentBox } from '../../src/CommentBox.tsx';
import { TooltipGroup } from '../../src/Tooltip.tsx';
import { setVim } from '../../src/vim.ts';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no root.');

createRoot(root).render(
  <TooltipGroup>
    <div id="box">
      <CommentBox
        label="New comment"
        focused
        head={{ where: 'Lines 39–41', account: { login: 'octocat' }, previewKeys: ['⌘', '⇧', 'P'] }}
        foot={{
          mode: { name: 'INSERT', kind: 'insert' },
          attach: { keys: ['⌘', '⇧', 'A'] },
          discard: {},
          actions: [
            { label: 'Send now', keys: ['⌥', '⏎'] },
            { label: 'Add to review', keys: ['⌘', '⏎'], primary: true },
          ],
        }}
      >
        <textarea aria-label="Comment" />
      </CommentBox>
    </div>
  </TooltipGroup>,
);

const box = {
  /** Makes the box `width` wide. */
  width(width: number): void {
    const host = document.getElementById('box');
    if (host) host.style.width = `${width}px`;
  },
  vim: setVim,
};

Object.assign(window, { box });

declare global {
  interface Window {
    /** What the comment box's spec drives the page with. */
    box: typeof box;
  }
}
