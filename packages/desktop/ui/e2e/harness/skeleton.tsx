// The page the skeleton spec drives: an overview, its code waiting as a code block's does while the
// local copy comes, and the overview's skeleton, each in a middle view's box of its own, as wide as
// the spec says.

import { createRoot } from 'react-dom/client';

import { parseArtifact } from '@lo/artifact';

import {
  CodeBlock,
  CodeBody,
  CodeSkeleton,
  OverviewDocument,
  OverviewSkeleton,
} from '../../src/overview/index.ts';

const ARTIFACT = [
  '---',
  'format: 1',
  'pr: 1',
  'commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87',
  '---',
  '',
  '## tl;dr',
  '',
  'The parser moves to its own module and splits on either line ending, so a file saved on Windows reads as the same lines.',
  '',
  '## How it works',
  '',
  'The parser now splits on either line ending:',
  '',
  ':::code src/parser.ts#L1-L5',
  ':::',
  '',
  'The formatter takes its line from the new path.',
  '',
  '## Where to look',
  '',
  'The split itself.',
  '',
].join('\n');

/** Each box: a middle view's, which the spec sizes, cutting off what's past its foot. */
const BOX = 'middle-view overflow-hidden';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no root.');
createRoot(root).render(
  <>
    <div id="overview" className={BOX}>
      <OverviewDocument
        tree={parseArtifact(ARTIFACT).tree}
        byline={
          <div className="lo-ov-bylines">
            <div className="lo-ov-byline">
              <span className="size-20" />
              rozed-bot
            </div>
          </div>
        }
        views={{
          excerpt: (node) => (
            <CodeBlock target={node.target}>
              <CodeBody rows={5}>
                <CodeSkeleton rows={5} />
              </CodeBody>
            </CodeBlock>
          ),
        }}
      />
    </div>
    <div id="skeleton" className={BOX}>
      <OverviewSkeleton />
    </div>
  </>,
);
