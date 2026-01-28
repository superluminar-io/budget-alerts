import type { StackProps } from 'aws-cdk-lib';
import {
  Arn,
  ArnFormat,
  CfnParameter,
  CustomResource,
  Stack,
  aws_budgets as budgets,
  custom_resources as cr,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_s3 as s3,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
  aws_sqs as sqs,
  Duration,
  PhysicalName,
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

    let notificationQueue: sqs.IQueue | undefined;

    if (props.budgetConfig.default.aggregationSnsTopicArn) {
      notificationQueue = new sqs.Queue(this, 'BudgetAggregationQueue', {
        queueName: PhysicalName.GENERATE_IF_NEEDED,
        visibilityTimeout: Duration.seconds(300),
      });
      notificationQueue.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ['sqs:SendMessage'],
          resources: [notificationQueue.queueArn],
          principals: [new iam.OrganizationPrincipal(orgId)],
        }),
      );
    }

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
            globalNotificationSQSQueueARN: notificationQueue?.queueArn,
          }),
        ),
        deploymentType: DeploymentType.serviceManaged(),
        capabilities: [Capability.NAMED_IAM],
        parameters: {
          DelegatedAdminAccountId: Stack.of(this).account,
        },
      });
      alertStackSet.node.addDependency(assetBucket);
      alertStackSet.node.addDependency(permissions);
    });

    if (props.budgetConfig.default.aggregationSnsTopicArn) {
      new iam.Role(this, 'BudgetSNSPublishRole', {
        assumedBy: new iam.OrganizationPrincipal(orgId),
        inlinePolicies: {
          PublishToSNS: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                actions: ['sns:Publish'],
                resources: [props.budgetConfig.default.aggregationSnsTopicArn],
              }),
            ],
          }),
        },
      });
    }
  }
}

export interface BudgetAlertProps extends StackSetStackProps {
  delegatedAdminAccountId: string;
  budget: OuBudgetAttachment;
  globalNotificationSQSQueueARN?: string;
}

class BudgetAlert extends StackSetStack {
  constructor(scope: Construct, id: string, props: BudgetAlertProps) {
    super(scope, id, props);

    const delegatedAdminAccountIdParam = new CfnParameter(this, 'DelegatedAdminAccountId', {
      type: 'String',
      description: 'Account ID of the StackSet administrator/delegated admin account',
    });

    const delegatedAdminAccountId = delegatedAdminAccountIdParam.valueAsString;

    const emailLookup = new CustomResource(this, 'AccountEmailLookup', {
      serviceToken: Arn.format({
        region: this.region,
        service: 'lambda',
        resource: 'function',
        resourceName: 'DescribeAccountEmailProviderFn',
        account: delegatedAdminAccountId,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        partition: this.partition,
      }),
      properties: {
        AccountId: this.account, // asks for THIS account’s email
      },
    });
    const accountEmail = emailLookup.getAttString('Email');

    const subscribers = [
      {
        subscriptionType: 'EMAIL',
        address: accountEmail,
      },
    ];
    if (props.globalNotificationSQSQueueARN) {
      const notificationTopic = new sns.Topic(this, 'BudgetNotificationTopic', {
        topicName: 'budget-alerts',
      });

      subscribers.push({
        subscriptionType: 'SNS',
        address: notificationTopic.topicArn,
      });
      notificationTopic.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ['sns:Subscribe'],
          resources: [notificationTopic.topicArn],
          principals: [new iam.ServicePrincipal('sqs.amazonaws.com')],
          conditions: {
            PrincipalOrgID: {
              StringEquals: delegatedAdminAccountId,
            },
          },
        }),
      );

      notificationTopic.addSubscription(
        new subscriptions.SqsSubscription(
          sqs.Queue.fromQueueArn(this, 'NotificationQueue', props.globalNotificationSQSQueueARN),
          {
            rawMessageDelivery: false,
          },
        ),
      );
    }

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
          subscribers,
        })) ?? [],
    });
  }
}
