import { type BudgetConfig } from '../../../lib/org/budget-config';
import {
  buildOuTree,
  computeEffectiveBudgets,
  computeHomogeneousSubtrees,
  computeOuBudgetAttachments,
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
        B: { amount: 100, currency: 'USD' }, // Inherit from A
        C: { amount: 500, currency: 'USD' },
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

  describe('homogeneous subtree visual examples', () => {
    /**
     * Example 1: Fully homogeneous subtree
     *
     * Root
     * └── Prod (amount: 50)
     *     ├── TeamA  (inherits 50)
     *     └── TeamB  (inherits 50)
     *
     * Expected:
     *  - Single attachment at Prod with amount 50
     *  - Root is not selected (different default budget)
     */
    it('Example 1: selects a single attachment for a fully homogeneous subtree', () => {
      const ous: OuNode[] = [
        { id: 'root', parentId: null },
        { id: 'prod', parentId: 'root' },
        { id: 'teamA', parentId: 'prod' },
        { id: 'teamB', parentId: 'prod' },
      ];

      const budgetConfig: BudgetConfig = {
        default: { amount: 10, currency: 'USD' },
        organizationalUnits: {
          // root implicitly uses default(10)
          prod: { amount: 50, currency: 'USD' },
          // teamA / teamB inherit 50 from prod
        },
      };

      const attachments = computeOuBudgetAttachments(ous, budgetConfig);

      expect(attachments).toEqual([{ ouId: 'prod', amount: 50, currency: 'USD' }]);
    });

    /**
     * Example 2: Heterogeneous sibling budgets are fine
     *
     * Root
     * └── Environments
     *     ├── Dev  (amount: 10)
     *     └── Prod (amount: 50)
     *
     * No accounts live in Root or Environments; only leaf OUs have accounts.
     *
     * Expected:
     *  - Attachments at Dev and Prod (each homogeneous on its own)
     *  - No attachment at Root / Environments
     */
    it('Example 2: selects separate attachments for dev/prod sibling budgets', () => {
      const ous: OuNode[] = [
        { id: 'root', parentId: null },
        { id: 'env', parentId: 'root' },
        { id: 'dev', parentId: 'env' },
        { id: 'prod', parentId: 'env' },
      ];

      const budgetConfig: BudgetConfig = {
        default: { amount: 10, currency: 'USD' },
        organizationalUnits: {
          // root / env both effectively 10 by default
          dev: { amount: 10, currency: 'USD' }, // explicit but same as default
          prod: { amount: 50, currency: 'USD' },
        },
      };

      const attachments = computeOuBudgetAttachments(ous, budgetConfig);

      expect(attachments).toHaveLength(2);
      expect(attachments).toEqual(
        expect.arrayContaining([
          { ouId: 'dev', amount: 10, currency: 'USD' },
          { ouId: 'prod', amount: 50, currency: 'USD' },
        ]),
      );
    });

    /**
     * Example 3: Applications subtree with one override
     *
     * Root (default: 10)
     * └── Applications (inherits 10)
     *     ├── Payroll    (amount: 20)
     *     └── Accounting (inherits 10)
     *
     * This is fine: Applications does not have accounts, only the leaf OUs do.
     *
     * Expected:
     *  - Attachment at Payroll with 20
     *  - Attachment at Accounting with 10 (default)
     *  - No attachment at Applications or Root
     */
    it('Example 3: handles one overridden child and one inheriting child under a common parent', () => {
      const ous: OuNode[] = [
        { id: 'root', parentId: null },
        { id: 'applications', parentId: 'root' },
        { id: 'payroll', parentId: 'applications' },
        { id: 'accounting', parentId: 'applications' },
      ];

      const budgetConfig: BudgetConfig = {
        default: { amount: 10, currency: 'USD' },
        organizationalUnits: {
          // root and applications both effectively 10 by default
          payroll: { amount: 20, currency: 'USD' },
          // accounting inherits default 10
        },
      };

      const attachments = computeOuBudgetAttachments(ous, budgetConfig);

      expect(attachments).toHaveLength(2);
      expect(attachments).toEqual(
        expect.arrayContaining([
          { ouId: 'payroll', amount: 20, currency: 'USD' },
          { ouId: 'accounting', amount: 10, currency: 'USD' },
        ]),
      );
    });

    /**
     * Example 4: Corrected layout for the "Finance with diverging budgets" scenario
     *
     * Root
     * ├── Finance-Common (amount: 10)
     * └── Payroll        (amount: 20)
     *
     * Here, accounts live only in leaf OUs and each subtree is homogeneous.
     *
     * Expected:
     *  - Attachment at Finance-Common (10)
     *  - Attachment at Payroll (20)
     */
    it('Example 4: uses separate OUs for finance-common and payroll budgets', () => {
      const ous: OuNode[] = [
        { id: 'root', parentId: null },
        { id: 'finance-common', parentId: 'root' },
        { id: 'payroll', parentId: 'root' },
      ];

      const budgetConfig: BudgetConfig = {
        default: { amount: 10, currency: 'USD' },
        organizationalUnits: {
          'finance-common': { amount: 10, currency: 'USD' }, // explicitly 10
          payroll: { amount: 20, currency: 'USD' },
        },
      };

      const attachments = computeOuBudgetAttachments(ous, budgetConfig);

      expect(attachments).toHaveLength(2);
      expect(attachments).toEqual(
        expect.arrayContaining([
          { ouId: 'finance-common', amount: 10, currency: 'USD' },
          { ouId: 'payroll', amount: 20, currency: 'USD' },
        ]),
      );
    });
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
