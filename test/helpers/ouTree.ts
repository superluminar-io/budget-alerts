import { type BudgetConfig } from '../../lib/org/budget-config';
import { sanitizeBudgetConfig } from '../../lib/org/budget-config-loader';
import { buildOuTree, type OuNode } from '../../lib/org/budget-planner';

export function makeOus(edges: [string, string | null][]): OuNode[] {
  return edges.map(([id, parentId]) => ({ id, parentId }));
}

interface DefaultBudget {
  amount: number;
  currency: string;
}

export function makeConfig(input: {
  default?: DefaultBudget;
  organizationalUnits?: BudgetConfig['organizationalUnits'];
}): BudgetConfig {
  const organizationalUnits = input.organizationalUnits ?? {};

  if (input.default) {
    // default is present
    return sanitizeBudgetConfig({
      default: input.default,
      organizationalUnits,
    });
  }

  // default omitted entirely
  return sanitizeBudgetConfig({
    default: undefined,
    organizationalUnits,
  });
}

export function treeFrom(edges: [string, string | null][]) {
  return buildOuTree(makeOus(edges));
}
