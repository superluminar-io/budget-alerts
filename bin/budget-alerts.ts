#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BudgetAlertsStack } from '../lib/budget-alerts-stack';
import { loadBudgetConfig } from '../lib/org/budget-config-loader';
import { loadOrgStructure } from '../lib/org/org-discovery';
import { type OuNode, validateBudgetConfig } from '../lib/org/budget-planner';

// const app = new cdk.App();
// new BudgetAlertsStack(app, 'BudgetAlertsStack', {});

async function main() {
  const app = new cdk.App();

  const configPath =
    (app.node.tryGetContext('budgetConfigPath') as string | undefined) ?? 'budget-config.yaml';

  const budgetConfig = loadBudgetConfig(configPath);

  const org = await loadOrgStructure();
  // Synthetic root node for the planner: parentId = null
  const allOusForPlanner: OuNode[] = [
    {
      id: org.root.id,
      parentId: null,
      name: org.root.name,
    },
    ...org.ous,
  ];

  // sanity: config must not reference unknown OUs
  validateBudgetConfig(
    budgetConfig,
    allOusForPlanner.map((ou) => ou.id),
  );

  new BudgetAlertsStack(app, 'BudgetAlertsStack', {
    budgetConfig,
    orgOus: allOusForPlanner,
  });
}

main().catch((err: unknown) => {
  console.error('Error during cdk app initialization:', err);
  process.exit(1);
});
