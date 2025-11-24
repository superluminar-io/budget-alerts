import { type BudgetConfig } from '../../../lib/org/budget-config';
import {
  buildOuTree,
  computeEffectiveBudgets,
  computeHomogeneousSubtrees,
  computeOuBudgetAttachments,
  OuBudgetAttachment,
  selectOuBudgetAttachments,
  validateBudgetConfig,
  type OuNode,
} from '../../../lib/org/budget-planner';

const simpleValidOus: OuNode[] = [
  { id: 'A', parentId: null },
  { id: 'B', parentId: 'A' },
  { id: 'C', parentId: 'A' },
  { id: 'D', parentId: 'B' },
  { id: 'E', parentId: 'B' },
];

describe('buildOUTree', () => {
  it('should build an OUTree from a flat list of items', () => {
    const tree = buildOuTree(simpleValidOus);

    expect(tree.roots).toEqual(['A']);
    expect(tree.children.get('A')).toEqual(['B', 'C']);
    expect(tree.children.get('B')).toEqual(['D', 'E']);
    expect(tree.children.get('C')).toBeUndefined();
    expect(tree.children.get('D')).toBeUndefined();
  });

  it('should throw exception on empty input', () => {
    const ous: OuNode[] = [];

    expect(() => buildOuTree(ous)).toThrow(/Expected exactly one root OU/);
  });

  it('should handle single root OU', () => {
    const ous: OuNode[] = [{ id: 'Root', parentId: null }];
    const tree = buildOuTree(ous);
    expect(tree.roots).toEqual(['Root']);
    expect(tree.children.size).toBe(0);
  });

  it('should ignore OUs without IDs', () => {
    const ous: OuNode[] = [
      { id: 'A', parentId: null },
      { id: '', parentId: 'A' }, // Invalid OU
      { id: 'B', parentId: 'A' },
    ];
    const tree = buildOuTree(ous);
    expect(tree.roots).toEqual(['A']);
    expect(tree.children.get('A')).toEqual(['B']);
  });
});

describe('computeEffectiveBudgets', () => {
  it('should compute effective budgets with inheritance', () => {
    const tree = buildOuTree(simpleValidOus);

    const budgetConfig: BudgetConfig = {
      default: { amount: 1000, currency: 'USD' },
      organizationalUnits: {
        A: { amount: null, currency: 'USD' },
        B: { amount: 100, currency: 'USD' }, // Inherit from A
        C: { amount: 500, currency: 'USD' },
        D: { amount: null, currency: 'USD' }, // Inherit from B -> A
      },
    };

    const budgets = computeEffectiveBudgets(tree, budgetConfig);

    expect(budgets.get('A')).toEqual({ amount: 1000, currency: 'USD' });
    expect(budgets.get('B')).toEqual({ amount: 100, currency: 'USD' }); // Inherited from A
    expect(budgets.get('C')).toEqual({ amount: 500, currency: 'USD' });
    expect(budgets.get('D')).toEqual({ amount: 100, currency: 'USD' }); // Inherited from B -> A
  });

  it('should use default budget for OUs without explicit config', () => {
    const tree = buildOuTree(simpleValidOus);

    const budgetConfig: BudgetConfig = {
      default: { amount: 1500, currency: 'USD' },
      organizationalUnits: {
        B: { amount: 200, currency: 'USD' },
        C: { amount: 300, currency: 'USD' },
      },
    };

    const budgets = computeEffectiveBudgets(tree, budgetConfig);

    expect(budgets.get('A')).toEqual({ amount: 1500, currency: 'USD' });
    expect(budgets.get('B')).toEqual({ amount: 200, currency: 'USD' });
    expect(budgets.get('C')).toEqual({ amount: 300, currency: 'USD' });
    expect(budgets.get('D')).toEqual({ amount: 200, currency: 'USD' });
  });
});

describe('validateBudgetConfig', () => {
  it('should throw error for unknown OU IDs', () => {
    const tree = buildOuTree(simpleValidOus);

    const budgetConfig: BudgetConfig = {
      default: { amount: 1000, currency: 'USD' },
      organizationalUnits: {
        X: { amount: 100, currency: 'USD' }, // Unknown OU
      },
    };

    expect(() => {
      validateBudgetConfig(budgetConfig, Array.from(tree.byId.keys()));
    }).toThrow(/Budget config refers to unknown OU: X/);
  });

  it('should throw error for negative budget amounts', () => {
    const tree = buildOuTree(simpleValidOus);

    const budgetConfig: BudgetConfig = {
      default: { amount: 1000, currency: 'USD' },
      organizationalUnits: {
        A: { amount: -50, currency: 'USD' }, // Invalid negative amount
      },
    };

    expect(() => {
      validateBudgetConfig(budgetConfig, Array.from(tree.byId.keys()));
    }).toThrow(/OU A has invalid budget amount: -50/);
  });

  it('should allow null budget amounts', () => {
    const tree = buildOuTree(simpleValidOus);

    const budgetConfig: BudgetConfig = {
      default: { amount: 1000, currency: 'USD' },
      organizationalUnits: {
        A: { amount: null, currency: 'USD' }, // Valid null amount
      },
    };

    expect(() => {
      validateBudgetConfig(budgetConfig, Array.from(tree.byId.keys()));
    }).not.toThrow();
  });

  it('should not allow undefined entries', () => {
    const tree = buildOuTree(simpleValidOus);

    const budgetConfig: BudgetConfig = {
      default: { amount: 1000, currency: 'USD' },
      organizationalUnits: {
        A: undefined, // Invalid undefined entry
      },
    };

    expect(() => {
      validateBudgetConfig(budgetConfig, Array.from(tree.byId.keys()));
    }).toThrow(/Budget config for OU A is undefined/);
  });

  it('should pass for valid budget config', () => {
    const tree = buildOuTree(simpleValidOus);

    const budgetConfig: BudgetConfig = {
      default: { amount: 1000, currency: 'USD' },
      organizationalUnits: {
        A: { amount: 200, currency: 'USD' },
        B: { amount: null, currency: 'USD' },
      },
    };

    expect(() => {
      validateBudgetConfig(budgetConfig, Array.from(tree.byId.keys()));
    }).not.toThrow();
  });
});

describe('computeHomogeneousSubtrees', () => {
  it('should identify homogeneous subtrees correctly', () => {
    const tree = buildOuTree(simpleValidOus);

    const budgets = new Map<string, { amount: number; currency: string }>([
      ['A', { amount: 100, currency: 'USD' }],
      ['B', { amount: 100, currency: 'USD' }],
      ['C', { amount: 200, currency: 'USD' }],
      ['D', { amount: 100, currency: 'USD' }],
      ['E', { amount: 300, currency: 'USD' }],
    ]);

    const homogeneousSubtrees = computeHomogeneousSubtrees(tree, budgets);

    expect(homogeneousSubtrees).toEqual(new Set(['C', 'D', 'E']));
  });
});

describe('selectOuBudgetAttachments', () => {
  it('should select OUs for budget attachments based on homogeneous subtrees', () => {
    const tree = buildOuTree(simpleValidOus);

    const budgets = new Map<string, { amount: number; currency: string }>([
      ['A', { amount: 100, currency: 'USD' }],
      ['B', { amount: 100, currency: 'USD' }],
      ['C', { amount: 200, currency: 'USD' }],
      ['D', { amount: 100, currency: 'USD' }],
      ['E', { amount: 300, currency: 'USD' }],
    ]);

    const homogeneousSubtrees = computeHomogeneousSubtrees(tree, budgets);

    const attachments = selectOuBudgetAttachments(tree, budgets, homogeneousSubtrees);

    expect(attachments.length).toBe(3);
    expect(attachments).toEqual(
      expect.arrayContaining([
        { amount: 200, currency: 'USD', ouId: 'C' },
        { amount: 100, currency: 'USD', ouId: 'D' },
        { amount: 300, currency: 'USD', ouId: 'E' },
      ]),
    );
  });
});

describe('computeOuBudgetAttachments', () => {
  it('should compute OU budget attachments correctly', () => {
    const budgetConfig: BudgetConfig = {
      default: { amount: 1000, currency: 'USD' },
      organizationalUnits: {
        A: { amount: null, currency: 'USD' },
        B: { amount: 100, currency: 'USD' },
        C: { amount: 500, currency: 'USD' },
        D: { amount: null, currency: 'USD' },
      },
    };

    const attachments = computeOuBudgetAttachments(simpleValidOus, budgetConfig);

    expect(attachments.length).toBe(2);
    expect(attachments).toEqual(
      expect.arrayContaining([
        { amount: 100, currency: 'USD', ouId: 'B' },
        { amount: 500, currency: 'USD', ouId: 'C' },
      ]),
    );
  });
});
