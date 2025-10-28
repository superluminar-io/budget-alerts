import {
  Stack,
  aws_budgets as budgets,
  aws_iam as iam,
  aws_kms as kms,
  aws_sns as sns,
  custom_resources as cr,
  Fn,
  Token,
} from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
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
        resources: [budgetAlertsTopic.topicArn],
        conditions: {
          StringEquals: {
            'aws:PrincipalOrgID': 'o-blikiivk10',
          },
        },
      }),
    );
    const listLz = new cr.AwsCustomResource(this, 'ListLandingZones', {
      onCreate: {
        service: 'ControlTower',
        action: 'listLandingZones',
        region: this.region,
        physicalResourceId: cr.PhysicalResourceId.of('ListLandingZonesOnce'),
        outputPaths: ['landingZones.0.arn'],
      },
      onUpdate: {
        service: 'ControlTower',
        action: 'listLandingZones',
        region: this.region,
        physicalResourceId: cr.PhysicalResourceId.of('ListLandingZonesOnce'),
        outputPaths: ['landingZones.0.arn'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    const lzArn = listLz.getResponseField('landingZones.0.arn');

    // 2) Parse region from ARN for GetLandingZone calls
    const arnParts = Fn.split(':', lzArn); // arn:partition:service:region:account:resource
    const lzRegion = Fn.select(3, arnParts);

    // 3) Fetch landing zone details and read manifest.governedRegions
    // Response shape: landingZone.manifest is a JSON value containing governedRegions. :contentReference[oaicite:1]{index=1}
    const getLz = new cr.AwsCustomResource(this, 'GetLandingZone', {
      onCreate: {
        service: 'ControlTower',
        action: 'getLandingZone',
        region: this.region,
        parameters: { landingZoneIdentifier: lzArn },
        physicalResourceId: cr.PhysicalResourceId.of('GetLandingZoneByDiscoveredArn'),
        outputPaths: ['landingZone.manifest.governedRegions'],
      },
      onUpdate: {
        service: 'ControlTower',
        action: 'getLandingZone',
        region: lzRegion,
        parameters: { landingZoneIdentifier: lzArn },
        physicalResourceId: cr.PhysicalResourceId.of('GetLandingZoneByDiscoveredArn'),
        outputPaths: ['landingZone.manifest.governedRegions'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    const regions = getLz.getResponseField('landingZone.manifest.governedRegions');

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

    new StackSet(this, 'BudgetAlertStackSet', {
      target: StackSetTarget.fromOrganizationalUnits({
        organizationalUnits: [rootOuId],
        regions: Token.asList(regions),
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
