import {
  Stack,
  aws_budgets as budgets,
  aws_iam as iam,
  aws_kms as kms,
  aws_sns as sns,
} from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import { StackSetDeploymentModel } from 'aws-cdk-lib/aws-codepipeline-actions';
import {
  DeploymentType,
  StackSet,
  StackSetStack,
  StackSetTarget,
  StackSetTemplate,
} from 'cdk-stacksets';
import type { StackSetStackProps } from 'cdk-stacksets';
import type { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class BudgetAlertsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'BudgetAlertsQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    const alertTopicKey = new kms.Key(this, 'AlertTopicKey', {
      enableKeyRotation: true,
    });
    alertTopicKey.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
        resources: [alertTopicKey.keyArn],
        conditions: {
          StringEquals: {
            'aws:PrincipalOrgID': 'r-13ix',
          },
        },
      }),
    );

    const budgetAlertsTopic = new sns.Topic(this, 'BudgetAlertsTopic', {
      displayName: 'Budget Alerts Topic',
      masterKey: alertTopicKey,
    });

    budgetAlertsTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['SNS:Publish'],
        principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
        resources: [budgetAlertsTopic.topicArn],
        conditions: {
          StringEquals: {
            'aws:PrincipalOrgID': 'r-13ix',
          },
        },
      }),
    );

    new StackSet(this, 'BudgetAlertStackSet', {
      target: StackSetTarget.fromOrganizationalUnits({
        organizationalUnits: ['ou-xxxx-xxxxxxxx', 'ou-yyyy-yyyyyyyy'],
        regions: ['us-east-1', 'us-west-2'],
      }),
      template: StackSetTemplate.fromStackSetStack(
        new BudgetAlert(this, 'BudgetAlertTemplate', {
          topic: budgetAlertsTopic,
        }),
      ),
      deploymentType: DeploymentType.serviceManaged(),
    });
  }
}

interface BudgetAlertStackSetProps extends StackSetStackProps {
  topic: sns.ITopic;
}

class BudgetAlert extends StackSetStack {
  constructor(scope: Construct, id: string, props: BudgetAlertStackSetProps) {
    super(scope, id, props);

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: 50,
          unit: 'USD',
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              subscriptionType: 'SNS',
              address: props.topic.topicArn,
            },
          ],
        },
      ],
    });
  }
}
