// What Settings knows of each section its slot's views make: its title and the line under it. The
// views come from every feature, so the list beside the page needs both before it draws them.

import type { ReactNode } from 'react';

export interface SectionInfo {
  readonly title: string;
  readonly description?: ReactNode;
}

/** Each section's information, by the id of its view. */
export const sectionInfo = new Map<string, SectionInfo>();
