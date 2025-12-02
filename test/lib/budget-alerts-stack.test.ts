import { BudgetAlertsStack } from '../../lib/budget-alerts-stack';
import { computeOuBudgetAttachments, type OuNode } from '../../lib/org/budget-planner';
import { type BudgetConfig } from '../../lib/org/budget-config';
import { App, type Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

const STACKSET_RESOURCE_TYPE = 'AWS::CloudFormation::StackSet';

/**
 * Helper: create a CDK stack with custom OU structure + budget config.
 */
function synthStack(orgOus: OuNode[], budgetConfig: BudgetConfig): Stack {
  const app = new App();
  return new BudgetAlertsStack(app, 'TestStack', {
    orgOus,
    budgetConfig,
  });
}

/**
 * Helper: count StackSet resources in a synthesized template
 */
function countStackSets(template: Template): number {
  const resources = template.findResources(STACKSET_RESOURCE_TYPE);
  return Object.keys(resources).length;
}

describe('BudgetAlertsStack (CDK)', () => {
  //
  // EXAMPLE 1
  //
  it('generates ONE StackSet for a fully homogeneous subtree', () => {
    const orgOus: OuNode[] = [
      { id: 'root', parentId: null },
      { id: 'prod', parentId: 'root' },
      { id: 'teamA', parentId: 'prod' },
      { id: 'teamB', parentId: 'prod' },
    ];

    const config: BudgetConfig = {
      default: { amount: 10, currency: 'USD' },
      organizationalUnits: {
        prod: { amount: 50, currency: 'USD' },
      },
    };

    const expected = computeOuBudgetAttachments(orgOus, config).length;
    const stack = synthStack(orgOus, config);
    const template = Template.fromStack(stack);

    expect(countStackSets(template)).toBe(expected);
    expect(expected).toBe(1);
  });

  //
  // EXAMPLE 2
  //
  it('generates TWO StackSets for sibling leaf OUs with different budgets', () => {
    const orgOus: OuNode[] = [
      { id: 'root', parentId: null },
      { id: 'env', parentId: 'root' },
      { id: 'dev', parentId: 'env' },
      { id: 'prod', parentId: 'env' },
    ];

    const config: BudgetConfig = {
      default: { amount: 10, currency: 'USD' },
      organizationalUnits: {
        dev: { amount: 10, currency: 'USD' },
        prod: { amount: 50, currency: 'USD' },
      },
    };

    const expected = computeOuBudgetAttachments(orgOus, config).length;
    const stack = synthStack(orgOus, config);
    const template = Template.fromStack(stack);

    expect(expected).toBe(2); // dev + prod
    expect(countStackSets(template)).toBe(2);
  });

  //
  // EXAMPLE 3
  //
  it('generates TWO StackSets when one child overrides and one inherits', () => {
    const orgOus: OuNode[] = [
      { id: 'root', parentId: null },
      { id: 'apps', parentId: 'root' },
      { id: 'payroll', parentId: 'apps' },
      { id: 'accounting', parentId: 'apps' },
    ];

    const config: BudgetConfig = {
      default: { amount: 10, currency: 'USD' },
      organizationalUnits: {
        payroll: { amount: 20, currency: 'USD' },
      },
    };

    const expected = computeOuBudgetAttachments(orgOus, config).length;
    const stack = synthStack(orgOus, config);
    const template = Template.fromStack(stack);

    expect(expected).toBe(1 + 1); // payroll (20), accounting inherits default (10)
    expect(countStackSets(template)).toBe(expected);
  });

  //
  // EXAMPLE 4
  //
  it('generates TWO StackSets for Finance-Common and Payroll as separate OUs', () => {
    const orgOus: OuNode[] = [
      { id: 'root', parentId: null },
      { id: 'finance-common', parentId: 'root' },
      { id: 'payroll', parentId: 'root' },
    ];

    const config: BudgetConfig = {
      default: { amount: 10, currency: 'USD' },
      organizationalUnits: {
        'finance-common': { amount: 10, currency: 'USD' },
        payroll: { amount: 20, currency: 'USD' },
      },
    };

    const expected = computeOuBudgetAttachments(orgOus, config).length;
    const stack = synthStack(orgOus, config);
    const template = Template.fromStack(stack);

    expect(expected).toBe(2);
    expect(countStackSets(template)).toBe(2);
  });

  //
  // Additional sanity tests
  //
  it('generates one StackSet with default budget when no OU has accounts or overrides', () => {
    const orgOus: OuNode[] = [
      { id: 'root', parentId: null },
      { id: 'empty', parentId: 'root' },
    ];

    const config: BudgetConfig = {
      default: { amount: 10, currency: 'USD' },
      organizationalUnits: {},
    };

    const expected = computeOuBudgetAttachments(orgOus, config).length;
    const stack = synthStack(orgOus, config);
    const template = Template.fromStack(stack);

    expect(expected).toBe(1);
    expect(countStackSets(template)).toBe(1);
  });
});
