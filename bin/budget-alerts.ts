#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BudgetAlertsStack } from '../lib/budget-alerts-stack';
import { loadBudgetConfig } from '../lib/org/budget-config-loader';
import { loadOrgStructure } from '../lib/org/org-discovery';
import { validateBudgetConfig } from '../lib/org/budget-planner';

// const app = new cdk.App();
// new BudgetAlertsStack(app, 'BudgetAlertsStack', {});

async function main() {
  const app = new cdk.App();

  const configPath =
    (app.node.tryGetContext('budgetConfigPath') as string | undefined) ?? 'budget-config.yaml';

  const budgetConfig = loadBudgetConfig(configPath);

  const org = await loadOrgStructure();
  // Synthetic root node for the planner: parentId = null

  // sanity: config must not reference unknown OUs
  validateBudgetConfig(
    budgetConfig,
    org.ous.map((ou) => ou.id),
  );

  new BudgetAlertsStack(app, 'BudgetAlertsStack', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
    budgetConfig,
    orgOus: org.ous,
  });
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Error during cdk app initialization:', err);
  process.exit(1);
});
