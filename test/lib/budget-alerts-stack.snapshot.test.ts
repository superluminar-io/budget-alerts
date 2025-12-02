import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BudgetAlertsStack } from '../../lib/budget-alerts-stack';
import { type OuNode } from '../../lib/org/budget-planner';
import { type BudgetConfig } from '../../lib/org/budget-config';

// Disable CDK metadata for snapshots (no AWS::CDK::Metadata resources)
process.env.CDK_DISABLE_METADATA = 'true';

interface LambdaCodeProps {
  S3Key?: string;
  [key: string]: unknown;
}

interface TemplateResourceProperties {
  Code?: LambdaCodeProps;
  [key: string]: unknown;
}

interface TemplateResource {
  Type?: string;
  Properties?: TemplateResourceProperties;
  Metadata?: unknown;
  [key: string]: unknown;
}

interface TemplateJson {
  Metadata?: unknown;
  Resources?: Record<string, TemplateResource>;
  [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTemplateJson(value: unknown): value is TemplateJson {
  return isObject(value);
}

function normalize(template: unknown): TemplateJson {
  // Deep clone to avoid mutating the original
  const clonedUnknown = JSON.parse(JSON.stringify(template)) as unknown;

  if (!isTemplateJson(clonedUnknown)) {
    // In practice this should never happen with Template.toJSON(),
    // but returning an empty object keeps the type system happy.
    return {};
  }

  const cloned: TemplateJson = clonedUnknown;

  // Remove top-level Metadata (CDK toolkit info, etc.)
  if (cloned.Metadata !== undefined) {
    delete cloned.Metadata;
  }

  const resources = cloned.Resources;
  if (!resources) {
    return cloned;
  }

  // Strip volatile fields from each resource
  Object.keys(resources).forEach((logicalId) => {
    const resource = resources[logicalId];

    // Remove resource-level Metadata if present
    if (resource.Metadata !== undefined) {
      delete resource.Metadata;
    }

    const props = resource.Properties;
    if (!props) {
      return;
    }

    const code = props.Code;
    if (code && typeof code.S3Key === 'string') {
      code.S3Key = '<asset-hash-stripped>';
    }
  });

  return cloned;
}

function synthNormalizedTemplate(orgOus: OuNode[], budgetConfig: BudgetConfig): TemplateJson {
  const app = new cdk.App();
  const stack = new BudgetAlertsStack(app, 'SnapshotTestStack', {
    orgOus,
    budgetConfig,
  });

  const raw = Template.fromStack(stack).toJSON();
  return normalize(raw);
}

describe('BudgetAlertsStack Snapshot Tests (Normalized)', () => {
  it('matches snapshot for a single homogeneous subtree', () => {
    const orgOus: OuNode[] = [
      { id: 'root', parentId: null },
      { id: 'prod', parentId: 'root' },
      { id: 'teamA', parentId: 'prod' },
    ];

    const config: BudgetConfig = {
      default: { amount: 10, currency: 'USD' },
      organizationalUnits: {
        prod: { amount: 50, currency: 'USD' },
      },
    };

    const template = synthNormalizedTemplate(orgOus, config);
    expect(template).toMatchSnapshot();
  });

  it('matches snapshot for sibling leaf OUs with different budgets', () => {
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

    const template = synthNormalizedTemplate(orgOus, config);
    expect(template).toMatchSnapshot();
  });

  it('matches snapshot for overridden and inherited children', () => {
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

    const template = synthNormalizedTemplate(orgOus, config);
    expect(template).toMatchSnapshot();
  });
});
