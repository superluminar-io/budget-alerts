import {
  computeEffectiveBudgets,
  computeOuBudgetAttachments,
} from '../../../lib/org/budget-planner';
import { makeConfig, treeFrom } from '../../helpers/ouTree';
import { DEFAULT_THRESHOLDS } from '../../../lib/org/budget-config';

describe('computeEffectiveBudgets - no default', () => {
  test('no default + no overrides => all OUs undefined', () => {
    // root
    //  └─ ou-a
    //     └─ ou-b
    const tree = treeFrom([
      ['r', null],
      ['ou-a', 'r'],
      ['ou-b', 'ou-a'],
    ]);

    const config = makeConfig({}); // default omitted

    const eff = computeEffectiveBudgets(tree, config);

    expect(eff.get('r')?.amount).toBeUndefined();
    expect(eff.get('ou-a')?.amount).toBeUndefined();
    expect(eff.get('ou-b')?.amount).toBeUndefined();
  });

  test('no default + override sets budget => budget propagates to descendants', () => {
    const tree = treeFrom([
      ['r', null],
      ['ou-a', 'r'],
      ['ou-b', 'ou-a'],
      ['ou-x', 'r'],
    ]);

    const config = makeConfig({
      organizationalUnits: {
        'ou-a': { amount: 123, currency: 'EUR' },
      },
    });

    const eff = computeEffectiveBudgets(tree, config);

    expect(eff.get('r')?.amount).toBeUndefined();
    expect(eff.get('ou-x')?.amount).toBeUndefined();

    expect(eff.get('ou-a')).toEqual({
      amount: 123,
      currency: 'EUR',
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(eff.get('ou-b')).toEqual({
      amount: 123,
      currency: 'EUR',
      thresholds: DEFAULT_THRESHOLDS,
    });
  });

  test('no default + amount:null override => remains undefined (explicit disable)', () => {
    const tree = treeFrom([
      ['r', null],
      ['ou-a', 'r'],
    ]);

    const config = makeConfig({
      organizationalUnits: {
        'ou-a': { amount: null },
      },
    });

    const eff = computeEffectiveBudgets(tree, config);

    expect(eff.get('r')?.amount).toBeUndefined();
    expect(eff.get('ou-a')?.amount).toBeUndefined();
  });
});

describe('computeOuBudgetAttachments - no default', () => {
  test('no default + no overrides => no attachments', () => {
    const ous = [
      { id: 'r', parentId: null },
      { id: 'ou-a', parentId: 'r' },
      { id: 'ou-b', parentId: 'ou-a' },
    ];

    const config = makeConfig({});

    const attachments = computeOuBudgetAttachments(ous, config);
    expect(attachments).toEqual([]);
  });

  test('no default + budgeted subtree + disabled child => attachments avoid disabled area', () => {
    // r
    //  └─ ou-a (100 EUR)
    //      ├─ ou-b (disabled)
    //      └─ ou-c (inherits 100 EUR)
    const ous = [
      { id: 'r', parentId: null },
      { id: 'ou-a', parentId: 'r' },
      { id: 'ou-b', parentId: 'ou-a' },
      { id: 'ou-c', parentId: 'ou-a' },
    ];

    const config = makeConfig({
      organizationalUnits: {
        'ou-a': { amount: 100, currency: 'EUR' },
        'ou-b': { amount: null }, // disable subtree
      },
    });

    const attachments = computeOuBudgetAttachments(ous, config);

    // The exact output depends on your homogeneous-subtree selection,
    // but it MUST NOT attach at ou-a (would hit ou-b).
    // It SHOULD attach at ou-c (or whatever minimal disjoint OUs cover only budgeted leaves).
    expect(attachments).toEqual([
      {
        ouId: 'ou-c',
        amount: 100,
        currency: 'EUR',
        thresholds: DEFAULT_THRESHOLDS,
      },
    ]);
  });

  test('same amount + different thresholds leads to different attachments', () => {
    // r
    //  └─ ou-a (100 EUR)
    //      ├─ ou-b (100 EUR, uses default thresholds)
    //      └─ ou-c (100 EUR, custom thresholds)
    const ous = [
      { id: 'ou-a', parentId: null },
      { id: 'ou-b', parentId: 'ou-a' },
      { id: 'ou-c', parentId: 'ou-a' },
    ];
    const config = makeConfig({
      organizationalUnits: {
        'ou-a': { amount: 100, currency: 'EUR', thresholds: [50, 90] },
        'ou-b': { amount: 100, currency: 'EUR' },
      },
    });

    const attachments = computeOuBudgetAttachments(ous, config);

    expect(attachments).toEqual([
      { ouId: 'ou-b', amount: 100, currency: 'EUR', thresholds: DEFAULT_THRESHOLDS },
      { ouId: 'ou-c', amount: 100, currency: 'EUR', thresholds: [50, 90] },
    ]);
  });
});
