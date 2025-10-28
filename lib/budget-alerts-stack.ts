import {Stack, StackProps, aws_budgets as budgets, aws_iam as iam, aws_sns as sns} from 'aws-cdk-lib';
import {StackSetStack, StackSetStackProps} from 'cdk-stacksets';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class BudgetAlertsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);


    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'BudgetAlertsQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    const budgetAlertsTopic = new sns.Topic(this, 'BudgetAlertsTopic', {
      displayName: 'Budget Alerts Topic'
    });
    budgetAlertsTopic.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['SNS:Publish'],
      principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
      resources: [budgetAlertsTopic.topicArn],
      conditions: {
        ArnEquals: {
          'aws:SourceArn': `arn:aws:budgets::${this.account}:budget/*`
        },
        "StringEquals": {
          "aws:PrincipalOrgID": "r-13ix"
        }
      }
    }))
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
          unit: 'USD'
        }
      },
      notificationsWithSubscribers: [{
        notification: {
          notificationType: 'ACTUAL',
          comparisonOperator: 'GREATER_THAN',
          threshold: 80,
          thresholdType: 'PERCENTAGE'
        },
        subscribers: [{
          subscriptionType: 'SNS',
          address: props.topic.topicArn
        }],
      }]
    });
  }
}
