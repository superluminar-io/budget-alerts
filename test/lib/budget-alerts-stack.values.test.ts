import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BudgetAlertsStack } from '../../lib/budget-alerts-stack';
import { computeOuBudgetAttachments, type OuNode } from '../../lib/org/budget-planner';
import type { BudgetConfig } from '../../lib/org/budget-config';
import { Manifest } from 'aws-cdk-lib/cloud-assembly-schema';

/**
 * --- TYPES FOR CFN TEMPLATE ---
 */

interface BudgetLimit {
  Amount?: number | string;
  Unit?: string;
}

interface BudgetProps {
  Budget?: {
    BudgetLimit?: BudgetLimit;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface BudgetResource {
  Type: 'AWS::Budgets::Budget';
  Properties?: BudgetProps;
  [key: string]: unknown;
}

interface StackSetTemplateUrl {
  Bucket?: string;
  'Fn::Sub': string;
}

interface StackSetProperties {
  TemplateURL?: StackSetTemplateUrl;
  [key: string]: unknown;
}

interface StackSetResource {
  Type: 'AWS::CloudFormation::StackSet';
  Properties?: StackSetProperties;
  [key: string]: unknown;
}

interface TemplateJson {
  Resources?: Record<string, unknown>;
  [key: string]: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isBudgetResource(v: unknown): v is BudgetResource {
  return isRecord(v) && v.Type === 'AWS::Budgets::Budget' && isRecord(v.Properties);
}

function isStackSetResource(v: unknown): v is StackSetResource {
  return isRecord(v) && v.Type === 'AWS::CloudFormation::StackSet' && isRecord(v.Properties);
}

function isTemplateUrl(v: unknown): v is StackSetTemplateUrl {
  console.log(' Checking TemplateURL type:', JSON.stringify(v));
  return isRecord(v) && typeof v.Key === 'string';
}

/**
 * Extract nested template file paths from a synthesized root template.
 */
function extractNestedTemplatePaths(
  template: TemplateJson,
  assetFilePath: string,
  outDir: string,
): string[] {
  const resources = template.Resources;
  if (!isRecord(resources)) return [];
  const assets = Manifest.loadAssetManifest(assetFilePath);

  const paths: string[] = [];

  for (const key of Object.keys(resources)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = resources[key];

    if (!isStackSetResource(res)) continue;

    const tplUrl = res.Properties?.TemplateURL;
    if (!tplUrl) continue;
    console.log(' Found TemplateURL:', JSON.stringify(tplUrl));

    const assetHash = path.parse(tplUrl['Fn::Sub']).name;
    if (!assets.files?.[assetHash]?.source.path) {
      throw new Error(`Asset with hash ${assetHash} not found in asset manifest.`);
    }
    const aPath = assets.files[assetHash].source.path;
    const asset = path.join(outDir, aPath);
    paths.push(asset);
    console.log(' Found nested template path:', asset);
  }

  return paths;
}

/**
 * Find the Budget resource inside a nested template.
 */
function extractBudgetResource(template: TemplateJson): BudgetResource | undefined {
  const res = template.Resources;
  if (!isRecord(res)) return undefined;

  for (const key of Object.keys(res)) {
    const r = res[key];
    if (isBudgetResource(r)) {
      return r;
    }
  }

  return undefined;
}

/**
 * Load and parse a nested synthesized CFN template from disk.
 */
function loadNestedTemplate(filePath: string): TemplateJson {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text) as TemplateJson;
}

/**
 * Synthesize the root stack and return template + output directory.
 */
function synthRootTemplate(orgOus: OuNode[], budgetConfig: BudgetConfig) {
  const app = new cdk.App();
  const stack = new BudgetAlertsStack(app, 'BudgetWiringTestStack', {
    orgOus,
    budgetConfig,
  });

  console.log(stack.templateFile);
  const assetFileSplit = path.basename(stack.templateFile).split('.');
  assetFileSplit[1] = 'assets';
  const assetFilePath = path.join(app.outdir, assetFileSplit.join('.'));

  const assembly = app.synth();
  const outDir = assembly.directory;
  console.log('Synthesized assembly at:', outDir);
  const rootTemplate = Template.fromStack(stack).toJSON() as TemplateJson;

  return { rootTemplate, outDir, assetFilePath };
}

/**
 * ---- TESTS ----
 */

describe('BudgetAlertsStack – budget wiring in nested templates', () => {
  it('injects correct BudgetLimit for a single subtree (prod)', () => {
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

    const attachments = computeOuBudgetAttachments(orgOus, config);
    expect(attachments).toHaveLength(1);

    const expectedAmount = attachments[0].amount;
    const expectedCurrency = attachments[0].currency;

    const { rootTemplate, outDir, assetFilePath } = synthRootTemplate(orgOus, config);

    const nestedPaths = extractNestedTemplatePaths(rootTemplate, assetFilePath, outDir);
    expect(nestedPaths).toHaveLength(1);

    const nested = loadNestedTemplate(nestedPaths[0]);
    const budget = extractBudgetResource(nested);

    expect(budget).toBeDefined();
    const limit = budget?.Properties?.Budget?.BudgetLimit;

    expect(limit?.Amount).toBe(expectedAmount);
    expect(limit?.Unit).toBe(expectedCurrency);
  });

  it('injects correct BudgetLimit values for dev/prod sibling subtrees', () => {
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

    const { rootTemplate, outDir, assetFilePath } = synthRootTemplate(orgOus, config);

    const nestedPaths = extractNestedTemplatePaths(rootTemplate, assetFilePath, outDir);
    expect(nestedPaths).toHaveLength(2);

    const nestedTemplates = nestedPaths.map(loadNestedTemplate);
    const budgets = nestedTemplates
      .map(extractBudgetResource)
      .filter((b): b is BudgetResource => b !== undefined);

    // 🔥 Direct array comparison, no sorting, no mapping
    expect(budgets).toMatchObject([
      {
        Properties: {
          Budget: {
            BudgetLimit: {
              Amount: 10,
              Unit: 'USD',
            },
          },
        },
      },
      {
        Properties: {
          Budget: {
            BudgetLimit: {
              Amount: 50,
              Unit: 'USD',
            },
          },
        },
      },
    ]);
  });
});
