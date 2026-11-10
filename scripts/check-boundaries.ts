// Checks the workspace's boundaries: each project's tags against its folder, and every import,
// dependency and edge of Nx's project graph against the rules its tags set. The rules are in
// AGENTS.md under "Boundaries".
//
//   pnpm check:boundaries

import { createProjectGraphAsync, workspaceRoot } from '@nx/devkit';

import { checkBoundaries, type Edge, type Project } from './boundaries/check.ts';

const graph = await createProjectGraphAsync({ exitOnError: true });
const projects: Project[] = Object.values(graph.nodes).map(({ name, data }) => ({
  name,
  root: data.root,
  tags: data.tags ?? [],
  packageName: data.metadata?.js?.packageName,
}));

const edges: Edge[] = Object.values(graph.dependencies).flatMap((dependencies) =>
  dependencies.map(({ source, target }) => ({ source, target })),
);

const violations = checkBoundaries(workspaceRoot, projects, edges);
for (const { where, message } of violations) console.error(`${where}: ${message}`);
if (violations.length > 0) {
  console.error(`\n${violations.length} boundary violation(s). See "Boundaries" in AGENTS.md.`);
  process.exit(1);
}
console.log(`Boundaries hold across ${projects.length} projects.`);
