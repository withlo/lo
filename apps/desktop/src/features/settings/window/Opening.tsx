// Settings' Opening PRs section: how a pull request's tab opens, in the rows other features put in
// the `settings.opening` slot.

import { Slot } from '../../../window/slots.tsx';
import { defineSection, opening } from './shared.ts';

export default defineSection({
  id: 'settings.opening',
  title: 'Opening PRs',
  order: 30,
  render: () => <Slot slot={opening} props={{}} />,
});
