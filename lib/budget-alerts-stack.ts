import type { StackProps } from 'aws-cdk-lib';
import {
  Arn,
  ArnFormat,
  CustomResource,
  Stack,
  aws_budgets as budgets,
  custom_resources as cr,
  aws_iam as iam,
  aws_kms as kms,
  aws_lambda as lambda,
  aws_s3 as s3,
  aws_sns as sns,
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
import { permission } from 'process';

const ORG_ID = 'o-blikiivk10';
const BUDGGET_ALERTS_TOPIC_NAME = 'BudgetAlerts';
const BUDGET_ALERTS_ACCOUNT_ID = '391613010373';
const DELEGATED_ADMIN_ACCOUNT_ID = '043443579270';

export class BudgetAlertsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const getMailFn = new NodejsFunction(this, 'get-mail', {
      functionName: 'DescribeAccountEmailFn',
    });
    const providerName = 'DescribeAccountEmailProviderFn';
    const provider = new cr.Provider(this, 'DescribeAccountEmailProvider', {
      onEventHandler: getMailFn,
      providerFunctionName: providerName,
    });

    provider.onEventHandler.addPermission('Invoke', {
      principal: new iam.OrganizationPrincipal(ORG_ID),
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
      principalOrgId: ORG_ID, // <— put your Org ID here
    });
    permissions.node.addDependency(provider);

    const listRoots = new cr.AwsCustomResource(this, 'ListOrgRoots', {
      onCreate: {
        service: 'Organizations',
        action: 'listRoots',
        region: this.region,
        physicalResourceId: cr.PhysicalResourceId.of('ListOrgRootsOnce'),
        outputPaths: ['Roots.0.Id', 'Roots.0.Arn', 'Roots.0.Name'],
      },
      onUpdate: {
        service: 'Organizations',
        action: 'listRoots',
        region: this.region,
        physicalResourceId: cr.PhysicalResourceId.of('ListOrgRootsOnce'),
        outputPaths: ['Roots.0.Id'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    const rootOuId = listRoots.getResponseField('Roots.0.Id'); // e.g. r-xxxx

    const assetBucketPrefix = 'budget-alerts-stackset-assets';
    const assetBucket = new s3.Bucket(this, 'Assets', {
      bucketName: `${assetBucketPrefix}-${this.region}`,
    });

    assetBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:Get*', 's3:List*'],
        resources: [assetBucket.arnForObjects('*'), assetBucket.bucketArn],
        principals: [new iam.OrganizationPrincipal(ORG_ID)],
      }),
    );

    const target = StackSetTarget.fromOrganizationalUnits({
      organizationalUnits: [rootOuId],
      regions: [this.region],
    });
    const alertStackSet = new StackSet(this, 'BudgetAlertStackSet', {
      target,
      template: StackSetTemplate.fromStackSetStack(
        new BudgetAlert(this, 'BudgetAlertTemplate', {
          assetBuckets: [assetBucket],
          assetBucketPrefix: assetBucketPrefix,
        }),
      ),
      deploymentType: DeploymentType.serviceManaged(),
      capabilities: [Capability.NAMED_IAM],
    });
    //const notifierStack = new BudgetNotifierStack(this, 'BudgetNotifierTemplate', {
    //assetBuckets: [assetBucket],
    //assetBucketPrefix: assetBucketPrefix,
    //});
    //const notifierStackSet = new StackSet(this, 'BudgetNotifierStackSet', {
    //target: StackSetTarget.fromAccounts({
    //accounts: [BUDGET_ALERTS_ACCOUNT_ID],
    //regions: [this.region],
    //}),
    //template: StackSetTemplate.fromStackSetStack(notifierStack),
    //deploymentType: DeploymentType.selfManaged({
    //adminRole: iam.Role.fromRoleName(
    //this,
    //'AdminRole',
    //'AWSCloudFormationStackSetAdministrationRole',
    //),
    //executionRoleName: 'AWSCloudFormationStackSetExecutionRole',
    //}),
    //capabilities: [Capability.NAMED_IAM],
    //});
    //alertStackSet.node.addDependency(notifierStackSet);
    //notifierStackSet.node.addDependency(assetBucket);
    alertStackSet.node.addDependency(assetBucket);
    alertStackSet.node.addDependency(permissions);
  }
}

//class BudgetNotifierStack extends StackSetStack {
//constructor(scope: Construct, id: string, props?: StackSetStackProps) {
//super(scope, id, props);

//const alertTopicKey = new kms.Key(this, 'AlertTopicKey', {
//enableKeyRotation: true,
//});
//alertTopicKey.addToResourcePolicy(
//new iam.PolicyStatement({
//actions: [
//'kms:Encrypt',
//'kms:Decrypt',
//'kms:ReEncrypt*',
//'kms:GenerateDataKey*',
//'kms:DescribeKey',
//],
//principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
//resources: ['*'],
//conditions: {
//StringEquals: {
//'aws:PrincipalOrgID': ORG_ID,
//},
//},
//}),
//);

//const budgetAlertsTopic = new sns.Topic(this, 'BudgetAlertsTopic', {
//displayName: 'Budget Alerts Topic',
//topicName: BUDGGET_ALERTS_TOPIC_NAME,
//masterKey: alertTopicKey,
//});

//budgetAlertsTopic.addToResourcePolicy(
//new iam.PolicyStatement({
//actions: ['SNS:Publish'],
//principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
//resources: ['*'],
//conditions: {
//StringEquals: {
//'aws:PrincipalOrgID': ORG_ID,
//},
//},
//}),
//);
//}
//}

class BudgetAlert extends StackSetStack {
  constructor(scope: Construct, id: string, props?: StackSetStackProps) {
    super(scope, id, props);

    const emailLookup = new CustomResource(this, 'AccountEmailLookup', {
      serviceToken: Arn.format({
        region: this.region,
        service: 'lambda',
        resource: 'function',
        resourceName: 'DescribeAccountEmailProviderFn',
        account: DELEGATED_ADMIN_ACCOUNT_ID,
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
          amount: 100,
          unit: 'USD',
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
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 50,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            //{
            //subscriptionType: 'SNS',
            //address: Arn.format({
            //region: this.region,
            //service: 'sns',
            //resource: 'topic',
            //resourceName: BUDGGET_ALERTS_TOPIC_NAME,
            //account: BUDGET_ALERTS_ACCOUNT_ID,
            //arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
            //partition: this.partition,
            //}),
            //},
            {
              subscriptionType: 'EMAIL',
              address: accountEmail,
            },
          ],
        },
      ],
    });
  }
}
