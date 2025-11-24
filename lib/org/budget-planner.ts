/* eslint-disable @typescript-eslint/no-non-null-assertion */
// lib/org/budget-planner.ts

import type { BudgetConfig } from './budget-config';

export interface OuNode {
  id: string;
  parentId: string | null;
}

export interface OuBudgetAttachment {
  ouId: string;
  amount: number;
  currency: string;
}

export interface EffectiveBudget {
  amount: number;
  currency: string;
}

export interface OuTree {
  byId: Map<string, OuNode>;
  children: Map<string, string[]>; // parentId -> child OU ids
  roots: string[]; // OU ids whose parentId === null
}

/**
 * Build maps for quick OU lookups and parent->children relationships.
 *
 * This is the base structure other functions operate on.
 */
export function buildOuTree(ous: OuNode[]): OuTree {
  const byId = new Map<string, OuNode>();
  const children = new Map<string, string[]>();
  const roots: string[] = [];

  for (const ou of ous) {
    if (!ou.id) continue;
    byId.set(ou.id, ou);

    if (ou.parentId === null) {
      roots.push(ou.id);
    } else {
      const arr = children.get(ou.parentId) ?? [];
      arr.push(ou.id);
      children.set(ou.parentId, arr);
    }
  }
  if (roots.length !== 1) {
    throw new Error(`Expected exactly one root OU, found ${roots.length}: [${roots.join(', ')}]`);
  }

  return { byId, children, roots };
}

export function validateBudgetConfig(config: BudgetConfig, knownOus: string[]) {
  for (const [ouId, entry] of Object.entries(config.organizationalUnits)) {
    if (!entry) {
      throw new Error(`Budget config for OU ${ouId} is undefined`);
    }

    if (!knownOus.includes(ouId)) {
      throw new Error(`Budget config refers to unknown OU: ${ouId}`);
    }

    if (entry.amount !== null && entry.amount < 0) {
      throw new Error(`OU ${ouId} has invalid budget amount: ${entry.amount}`);
    }
  }
}

/**
 * Compute the effective budget for each OU:
 *  - if OU has an explicit amount != null -> use that
 *  - else inherit from parent OU
 *  - if no parent and no explicit config -> use config.default
 *
 * Important: root *of the organization* is not modeled here; we only see OUs.
 * OUs with parentId === null inherit directly from config.default unless they
 * have their own explicit entry.
 */
export function computeEffectiveBudgets(
  tree: OuTree,
  config: BudgetConfig,
): Map<string, EffectiveBudget> {
  const result = new Map<string, EffectiveBudget>();

  function resolve(ouId: string): EffectiveBudget {
    const cached = result.get(ouId);
    if (cached) return cached;

    const ou = tree.byId.get(ouId);
    if (!ou) {
      throw new Error(`Unknown OU id: ${ouId}`);
    }
    const cfgEntry = config.organizationalUnits[ouId];

    if (cfgEntry?.amount) {
      const eb: EffectiveBudget = {
        amount: cfgEntry.amount,
        currency: cfgEntry.currency ?? config.default.currency,
      };
      result.set(ouId, eb);
      return eb;
    }

    if (ou.parentId !== null) {
      const parentBudget = resolve(ou.parentId);
      result.set(ouId, parentBudget);
      return parentBudget;
    }

    // Top-level OU with no explicit config: use global default
    const eb: EffectiveBudget = {
      amount: config.default.amount,
      currency: config.default.currency,
    };
    result.set(ouId, eb);
    return eb;
  }

  const treeOuKeys = Array.from(tree.byId.keys());
  validateBudgetConfig(config, treeOuKeys);

  for (const ouId of tree.byId.keys()) {
    resolve(ouId);
  }

  return result;
}

/**
 * Determine for each OU whether its entire subtree has a single constant budget
 * (i.e. all descendants share the same EffectiveBudget).
 *
 * Returns a map ouId -> boolean.
 */
export function computeHomogeneousSubtrees(
  tree: OuTree,
  effectiveBudgets: Map<string, EffectiveBudget>,
): Set<string> {
  const homogeneous = new Map<string, boolean>();

  function isHomogeneous(ouId: string): boolean {
    const cached = homogeneous.get(ouId);
    if (cached !== undefined) return cached;

    const thisBudget = effectiveBudgets.get(ouId);
    if (!thisBudget) {
      throw new Error(`No effective budget for OU ${ouId}`);
    }

    const childIds = tree.children.get(ouId) ?? [];
    if (childIds.length === 0) {
      homogeneous.set(ouId, true);
      return true;
    }

    for (const childId of childIds) {
      if (!isHomogeneous(childId)) {
        homogeneous.set(ouId, false);
        return false;
      }

      const childBudget = effectiveBudgets.get(childId)!;
      if (
        childBudget.amount !== thisBudget.amount ||
        childBudget.currency !== thisBudget.currency
      ) {
        homogeneous.set(ouId, false);
        return false;
      }
    }

    homogeneous.set(ouId, true);
    return true;
  }

  for (const ouId of tree.byId.keys()) {
    isHomogeneous(ouId);
  }

  const result = new Set<string>();
  for (const [ouId, isHom] of homogeneous.entries()) {
    if (isHom) result.add(ouId);
  }

  return result;
}

/**
 * Select which OUs to actually attach budgets to:
 *
 *  - We assume every OU already has an EffectiveBudget (via computeEffectiveBudgets)
 *  - We assume we know which subtrees are homogeneous (via computeHomogeneousSubtrees)
 *
 * Algorithm:
 *  - For each root OU (parentId === null), traverse:
 *    - If subtree at this OU is homogeneous and no ancestor has been selected,
 *      select this OU and stop descending.
 *    - Otherwise, recurse into children.
 *
 * This effectively chooses "topmost homogeneous" OUs:
 *  - If a parent OU's budget is overridden in some child, the parent won't be selected.
 *  - The parent budget gets applied separately to all other OUs that still share it.
 */
export function selectOuBudgetAttachments(
  tree: OuTree,
  effectiveBudgets: Map<string, EffectiveBudget>,
  homogeneousSubtrees: Set<string>,
): OuBudgetAttachment[] {
  const attachments: OuBudgetAttachment[] = [];

  function traverse(ouId: string, ancestorSelected: boolean): void {
    const canCoverSubtree = homogeneousSubtrees.has(ouId);

    if (canCoverSubtree && !ancestorSelected) {
      const budget = effectiveBudgets.get(ouId)!;
      attachments.push({
        ouId,
        amount: budget.amount,
        currency: budget.currency,
      });
      return; // this OU covers its whole subtree
    }

    const childIds = tree.children.get(ouId) ?? [];
    for (const childId of childIds) {
      traverse(childId, ancestorSelected || canCoverSubtree);
    }
  }

  for (const rootOuId of tree.roots) {
    traverse(rootOuId, false);
  }

  return attachments;
}

/**
 * High-level orchestration:
 *  - build OU tree
 *  - compute effective budgets
 *  - compute homogeneous subtrees
 *  - select attachment OUs
 *
 * This is the function your CDK code will probably call, while the smaller
 * helpers are easy to unit-test in isolation.
 */
export function computeOuBudgetAttachments(
  ous: OuNode[],
  config: BudgetConfig,
): OuBudgetAttachment[] {
  const tree = buildOuTree(ous);
  const effectiveBudgets = computeEffectiveBudgets(tree, config);
  const homogeneous = computeHomogeneousSubtrees(tree, effectiveBudgets);
  return selectOuBudgetAttachments(tree, effectiveBudgets, homogeneous);
}
