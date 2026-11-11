/**
 * A module importing a package installed beside the checker, which Node could load from there:
 * built with the checker's config, it's inlined all the same.
 */

import { ESModulesEvaluator } from 'vite/module-runner';

export const evaluator = new ESModulesEvaluator();
