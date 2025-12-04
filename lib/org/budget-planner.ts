/* eslint-disable @typescript-eslint/no-non-null-assertion */
// lib/org/budget-planner.ts

import { DISABLED_CURRENCY, type Thresholds, type BudgetConfig } from './budget-config';

export interface OuNode {
  id: string;
  parentId: string | null;
}

export interface OuBudgetAttachment {
  ouId: string;
  amount: number;
  currency: string;
  thresholds?: Thresholds;
}

export interface EffectiveBudget {
  amount?: number;
  currency: string;
  thresholds?: Thresholds;
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
  if (config.organizationalUnits) {
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
    if (!config.organizationalUnits) {
      // No per-OU config at all: use global default
      const eb: EffectiveBudget = {
        amount: config.default.amount,
        currency: config.default.currency,
        thresholds: config.default.thresholds,
      };
      result.set(ouId, eb);
      return eb;
    }
    const cfgEntry = config.organizationalUnits[ouId];

    if (cfgEntry?.amount) {
      const eb: EffectiveBudget = {
        amount: cfgEntry.amount,
        currency: cfgEntry.currency ?? config.default.currency,
        thresholds: cfgEntry.thresholds ?? config.default.thresholds,
      };
      result.set(ouId, eb);
      return eb;
    } else {
      if (cfgEntry?.amount === null) {
        // Explicitly disabled budget
        const eb: EffectiveBudget = { currency: DISABLED_CURRENCY }; // currency is irrelevant here
        result.set(ouId, eb);
        return eb;
      }
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
      thresholds: config.default.thresholds,
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

function isEffectiveBudget(obj: unknown): obj is EffectiveBudget {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  if (
    !('amount' in (obj as Record<string, unknown>)) &&
    !('currency' in (obj as Record<string, unknown>))
  ) {
    return false;
  }

  return true;
}

export function equalBudgets(a: unknown, b: unknown): boolean {
  if (!isEffectiveBudget(a) || !isEffectiveBudget(b)) {
    return false;
  }
  const arrayEqual = <T>(a: readonly T[], b: readonly T[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  const retVal =
    a.amount === b.amount &&
    a.currency === b.currency &&
    arrayEqual(a.thresholds ?? [], b.thresholds ?? []);
  return retVal;
}

export function computeHomogeneousSubtrees(
  tree: OuTree,
  effectiveBudgets: Map<string, EffectiveBudget>,
) {
  return new Set(maximalUniformSubtreeRoots(tree, effectiveBudgets));
}

type Status<V> = { kind: 'mixed' } | { kind: 'uniform'; value: V };

const MIXED: Status<never> = { kind: 'mixed' };

function isUniform<V>(s: Status<V>): s is { kind: 'uniform'; value: V } {
  return s.kind === 'uniform';
}

/**
 * Returns the roots (ouIds) of maximal qualifying subtrees:
 * "a rooted subtree whose all nodes share a single common property value",
 * and it is maximal w.r.t. being "absorbed" by its parent with the same value.
 */
export function maximalUniformSubtreeRoots<V>(
  tree: OuTree,
  effectiveBudgets: Map<string, V>,
  equals: (a: V, b: V) => boolean = equalBudgets,
): string[] {
  // 1) Postorder DP: compute uniform/mixed status per node (memoized DFS)
  const statusById = new Map<string, Status<V>>();
  const visiting = new Set<string>(); // for cycle detection (shouldn't happen in a tree)

  const getChildren = (id: string): string[] => tree.children.get(id) ?? [];

  const computeStatus = (id: string): Status<V> => {
    const cached = statusById.get(id);
    if (cached) return cached;

    if (visiting.has(id)) {
      // If your data can never contain cycles, you can replace this with just MIXED or throw.
      throw new Error(`Cycle detected in OuTree at node ${id}`);
    }
    visiting.add(id);

    // The "property value" for this node:
    // Note: if .get(id) can be undefined and that’s meaningful, this still works.
    const myVal = effectiveBudgets.get(id) as V;

    // Combine children
    for (const childId of getChildren(id)) {
      const childStatus = computeStatus(childId);
      if (!isUniform(childStatus)) {
        statusById.set(id, MIXED);
        visiting.delete(id);
        return MIXED;
      }
      if (!equals(childStatus.value, myVal)) {
        statusById.set(id, MIXED);
        visiting.delete(id);
        return MIXED;
      }
    }

    const uniform: Status<V> = { kind: 'uniform', value: myVal };
    statusById.set(id, uniform);
    visiting.delete(id);
    return uniform;
  };

  // compute status for all nodes reachable from roots (and also any stragglers in byId)
  for (const r of tree.roots) computeStatus(r);
  for (const id of tree.byId.keys()) computeStatus(id);

  // 2) Collect maximal uniform subtree roots
  const result: string[] = [];

  for (const [id, st] of statusById.entries()) {
    if (!isUniform(st)) continue;

    const node = tree.byId.get(id);
    const parentId = node?.parentId ?? null;

    if (parentId === null) {
      // Root uniform subtree is maximal by definition (no parent to absorb it)
      result.push(id);
      continue;
    }

    const parentStatus = statusById.get(parentId);
    if (!parentStatus || !isUniform(parentStatus) || !equals(parentStatus.value, st.value)) {
      // Parent is mixed OR parent uniform but with different value => this node starts a maximal uniform subtree
      result.push(id);
    }
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
      if (budget.amount && budget.amount > 0) {
        attachments.push({
          ouId,
          amount: budget.amount,
          currency: budget.currency,
          thresholds: budget.thresholds,
        });
      }
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
  const homogeneous = maximalUniformSubtreeRoots(tree, effectiveBudgets);
  return selectOuBudgetAttachments(tree, effectiveBudgets, new Set(homogeneous));
}
