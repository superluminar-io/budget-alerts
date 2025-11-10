#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BudgetAlertsStack } from '../lib/budget-alerts-stack';

const app = new cdk.App();
new BudgetAlertsStack(app, 'BudgetAlertsStack', {});
