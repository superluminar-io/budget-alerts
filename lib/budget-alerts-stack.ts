import type { StackProps } from 'aws-cdk-lib';
import {
  Arn,
  ArnFormat,
  CustomResource,
  Stack,
  aws_budgets as budgets,
  custom_resources as cr,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_s3 as s3,
} from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { StackSetStackProps } from 'cdk-stacksets';
import {
  Capability,
  DeploymentType,
  StackSet,
  StackSetStack,
  StackSetTarget,
  StackSetTemplate,
} from 'cdk-stacksets';
import type { Construct } from 'constructs';
import {
  computeOuBudgetAttachments,
  type OuBudgetAttachment,
  type OuNode,
} from './org/budget-planner';
import { type BudgetConfig } from './org/budget-config';
import { AwsCustomResource } from 'aws-cdk-lib/custom-resources';

export interface BudgetAlertsStackProps extends StackProps {
  orgOus: OuNode[];
  budgetConfig: BudgetConfig;
}

export class BudgetAlertsStack extends Stack {
  constructor(scope: Construct, id: string, props: BudgetAlertsStackProps) {
    super(scope, id, props);

    const attachments = computeOuBudgetAttachments(props.orgOus, props.budgetConfig);

    const getOrgId = new AwsCustomResource(this, 'GetOrgId', {
      onUpdate: {
        service: 'Organizations',
        action: 'describeOrganization',
        physicalResourceId: cr.PhysicalResourceId.of('Id'),
        parameters: {},
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    const orgId = getOrgId.getResponseField('Organization.Id');

    const getMailFn = new NodejsFunction(this, 'get-mail', {
      functionName: 'DescribeAccountEmailFn',
    });
    const providerName = 'DescribeAccountEmailProviderFn';
    const provider = new cr.Provider(this, 'DescribeAccountEmailProvider', {
      onEventHandler: getMailFn,
      providerFunctionName: providerName,
    });

    provider.onEventHandler.addPermission('Invoke', {
      principal: new iam.OrganizationPrincipal(orgId),
    });

    getMailFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['organizations:DescribeAccount'],
        resources: ['*'],
      }),
    );

    // Allow CloudFormation from *your org* (or specific accounts) to invoke this Lambda
    const permissions = new lambda.CfnPermission(this, 'AllowOrgCfnInvoke', {
      action: 'lambda:InvokeFunction',
      functionName: providerName,
      principal: '*',
      principalOrgId: orgId,
      sourceArn: `arn:${this.partition}:cloudformation:*:*:stack/*/*`,
    });
    permissions.node.addDependency(provider);

    const assetBucketPrefix = 'budget-alerts-stackset-assets';
    const assetBucket = new s3.Bucket(this, 'Assets', {
      bucketName: `${assetBucketPrefix}-${this.account}-${this.region}`,
    });

    assetBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:Get*', 's3:List*'],
        resources: [assetBucket.arnForObjects('*'), assetBucket.bucketArn],
        principals: [new iam.OrganizationPrincipal(orgId)],
      }),
    );

    // Attachments are already filtered for valid amounts in computeOuBudgetAttachments.

    attachments.forEach((attachment) => {
      const target = StackSetTarget.fromOrganizationalUnits({
        organizationalUnits: [attachment.ouId],
        regions: [this.region],
      });
      const alertStackSet = new StackSet(this, `BudgetAlertStackSet-${attachment.ouId}`, {
        target,
        template: StackSetTemplate.fromStackSetStack(
          new BudgetAlert(this, `BudgetAlertTemplate-${attachment.ouId}`, {
            assetBuckets: [assetBucket],
            assetBucketPrefix: assetBucketPrefix,
            delegatedAdminAccountId: Stack.of(this).account,
            budget: attachment,
          }),
        ),
        deploymentType: DeploymentType.serviceManaged(),
        capabilities: [Capability.NAMED_IAM],
      });
      alertStackSet.node.addDependency(assetBucket);
      alertStackSet.node.addDependency(permissions);
    });
  }
}

export interface BudgetAlertProps extends StackSetStackProps {
  delegatedAdminAccountId: string;
  budget: OuBudgetAttachment;
}

class BudgetAlert extends StackSetStack {
  constructor(scope: Construct, id: string, props: BudgetAlertProps) {
    super(scope, id, props);

    const emailLookup = new CustomResource(this, 'AccountEmailLookup', {
      serviceToken: Arn.format({
        region: this.region,
        service: 'lambda',
        resource: 'function',
        resourceName: 'DescribeAccountEmailProviderFn',
        account: props.delegatedAdminAccountId,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        partition: this.partition,
      }),
      properties: {
        AccountId: this.account, // asks for THIS account’s email
      },
    });
    const accountEmail = emailLookup.getAttString('Email');

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: props.budget.amount,
          unit: props.budget.currency,
        },
        filterExpression: {
          not: {
            dimensions: {
              key: 'RECORD_TYPE',
              values: ['Credit'],
            },
          },
        },
      },
      notificationsWithSubscribers:
        props.budget.thresholds?.map((threshold) => ({
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: threshold,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              subscriptionType: 'EMAIL',
              address: accountEmail,
            },
          ],
        })) ?? [],
    });
  }
}
