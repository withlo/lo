// The page the overview's spec drives: one overview with terms and links, between two buttons.

import { createRoot } from 'react-dom/client';

import { parseArtifact } from '@lo/artifact';

import { OverviewDocument } from '../../src/overview/index.ts';

const ARTIFACT = [
  '---',
  'format: 1',
  'pr: 1',
  'commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87',
  '---',
  '',
  '## tl;dr',
  '',
  'A [bucket](term:bucket) holds [tokens](term:token), which [the limiter](code:src/limiter.ts#L1-L4) takes, as [the docs](https://example.com/) say.',
  '',
  '## Glossary',
  '',
  '- **Bucket**: what a tenant holds.',
  '- **Token**: one request’s worth.',
  '',
].join('\n');

const root = document.getElementById('root');
if (!root) throw new Error('The page has no root.');
createRoot(root).render(
  <>
    <button type="button" id="start">
      Start
    </button>
    <OverviewDocument tree={parseArtifact(ARTIFACT).tree} outline={false} />
    <button type="button" id="end">
      End
    </button>
  </>,
);
