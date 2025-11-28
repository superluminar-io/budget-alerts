import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BudgetAlertsStack } from '../../lib/budget-alerts-stack';
import { computeOuBudgetAttachments, type OuNode } from '../../lib/org/budget-planner';
import type { BudgetConfig } from '../../lib/org/budget-config';

const STACKSET_RESOURCE_TYPE = 'AWS::CloudFormation::StackSet';

interface StackSetDeploymentTargets {
  OrganizationalUnitIds?: unknown;
  [key: string]: unknown;
}

interface StackInstancesGroup {
  DeploymentTargets?: StackSetDeploymentTargets;
  [key: string]: unknown;
}

interface StackSetProperties {
  StackInstancesGroup?: unknown;
  [key: string]: unknown;
}

interface StackSetResource {
  Type?: string;
  Properties?: StackSetProperties;
  [key: string]: unknown;
}

interface TemplateJson {
  Resources?: Record<string, StackSetResource>;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extract all OU IDs that the synthesized StackSets target.
 *
 * This walks all AWS::CloudFormation::StackSet resources and collects
 * DeploymentTargets.OrganizationalUnitIds.
 */
function extractStackSetOuIds(template: unknown): string[] {
  if (!isRecord(template)) {
    return [];
  }

  const resourcesRaw = (template as TemplateJson).Resources;
  if (!resourcesRaw || !isRecord(resourcesRaw)) {
    return [];
  }

  const resources = resourcesRaw as Record<string, unknown>;
  const ouIds: string[] = [];

  Object.keys(resources).forEach((logicalId) => {
    const resourceUnknown = resources[logicalId];
    if (!isRecord(resourceUnknown)) {
      return;
    }

    const resource = resourceUnknown as StackSetResource;
    if (resource.Type !== STACKSET_RESOURCE_TYPE) {
      return;
    }

    const props = resource.Properties;
    if (!props) {
      return;
    }

    const groupsUnknown = props.StackInstancesGroup;
    if (!Array.isArray(groupsUnknown)) {
      return;
    }

    groupsUnknown.forEach((groupUnknown) => {
      if (!isRecord(groupUnknown)) {
        return;
      }

      const group = groupUnknown as StackInstancesGroup;
      const targets = group.DeploymentTargets;
      if (!targets) {
        return;
      }

      const idsUnknown = targets.OrganizationalUnitIds;
      if (!Array.isArray(idsUnknown)) {
        return;
      }

      idsUnknown.forEach((id) => {
        if (typeof id === 'string') {
          ouIds.push(id);
        }
      });
    });
  });

  return ouIds;
}

/**
 * Helper: synthesize BudgetAlertsStack for a given OU tree + config.
 */
function synthStack(orgOus: OuNode[], budgetConfig: BudgetConfig) {
  const app = new cdk.App();

  return new BudgetAlertsStack(app, 'OuTargetsStackTest', {
    orgOus,
    budgetConfig,
  });
}

describe('BudgetAlertsStack – StackSet target OU IDs', () => {
  it('targets the OU of a single homogeneous subtree', () => {
    // Root
    // └─ Prod (50)
    //    ├─ TeamA
    //    └─ TeamB
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

    const attachments = computeOuBudgetAttachments(orgOus, config);
    const expectedOuIds = attachments.map((a) => a.ouId).sort();

    const stack = synthStack(orgOus, config);
    const template = Template.fromStack(stack).toJSON();
    const ouIdsInTemplate = extractStackSetOuIds(template).sort();

    expect(ouIdsInTemplate).toEqual(expectedOuIds);
    expect(expectedOuIds).toEqual(['prod']);
  });

  it('targets both dev and prod for sibling leaf OUs with different budgets', () => {
    // Root
    // └─ Environments
    //    ├─ Dev  (10)
    //    └─ Prod (50)
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

    const attachments = computeOuBudgetAttachments(orgOus, config);
    const expectedOuIds = attachments.map((a) => a.ouId).sort();

    const stack = synthStack(orgOus, config);
    const template = Template.fromStack(stack).toJSON();
    const ouIdsInTemplate = extractStackSetOuIds(template).sort();

    expect(ouIdsInTemplate).toEqual(expectedOuIds);
    expect(expectedOuIds).toEqual(['dev', 'prod']);
  });

  it('targets payroll and accounting separately when one overrides and one inherits', () => {
    // Root (default: 10)
    // └─ Apps (10)
    //    ├─ Payroll    (20)
    //    └─ Accounting (10)
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

    const attachments = computeOuBudgetAttachments(orgOus, config);
    const expectedOuIds = attachments.map((a) => a.ouId).sort();

    const stack = synthStack(orgOus, config);
    const template = Template.fromStack(stack).toJSON();
    const ouIdsInTemplate = extractStackSetOuIds(template).sort();

    expect(ouIdsInTemplate).toEqual(expectedOuIds);
    expect(new Set(expectedOuIds)).toEqual(new Set(['payroll', 'accounting']));
  });

  it('targets finance-common and payroll as separate homogeneous subtrees', () => {
    // Root
    // ├─ Finance-Common (10)
    // └─ Payroll        (20)
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

    const attachments = computeOuBudgetAttachments(orgOus, config);
    const expectedOuIds = attachments.map((a) => a.ouId).sort();

    const stack = synthStack(orgOus, config);
    const template = Template.fromStack(stack).toJSON();
    const ouIdsInTemplate = extractStackSetOuIds(template).sort();

    expect(ouIdsInTemplate).toEqual(expectedOuIds);
    expect(new Set(expectedOuIds)).toEqual(new Set(['finance-common', 'payroll']));
  });
});
