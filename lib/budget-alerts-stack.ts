import type { StackProps } from 'aws-cdk-lib';
import {
  Stack,
  aws_budgets as budgets,
  custom_resources as cr,
  aws_iam as iam,
  aws_kms as kms,
  aws_sns as sns,
} from 'aws-cdk-lib';
import type { StackSetStackProps } from 'cdk-stacksets';
import {
  DeploymentType,
  StackSet,
  StackSetStack,
  StackSetTarget,
  StackSetTemplate,
} from 'cdk-stacksets';
import type { Construct } from 'constructs';

export class BudgetAlertsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

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
        resources: ['*'],
        conditions: {
          StringEquals: {
            'aws:PrincipalOrgID': 'o-blikiivk10',
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
        resources: ['*'],
        conditions: {
          StringEquals: {
            'aws:PrincipalOrgID': 'o-blikiivk10',
          },
        },
      }),
    );

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

    //const target = StackSetTarget.fromOrganizationalUnits({
    //organizationalUnits: [rootOuId],
    //regions: Token.asList(discovery.governedRegions),
    //});
    const target = StackSetTarget.fromOrganizationalUnits({
      organizationalUnits: ['ou-13ix-x5ytj34j'],
      additionalAccounts: ['084274240787'],
      regions: [this.region],
    });
    new StackSet(this, 'BudgetAlertStackSet', {
      target,
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
