import { SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import log from 'loglevel';

log.setLevel(log.levels.INFO);

const sns = new SNSClient({});

interface OnEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties?: {
    /**
     * SNS topic name (not ARN)
     */
    topicName: string;

    /**
     * Subscriber account ID (member account) where the BudgetNotificationTopic exists.
     */
    accountId: string;

    /**
     * Region for the topic/queue.
     */
    region: string;

    /**
     * Delegated admin / StackSet admin account (topic owner).
     * This is the account where the aggregation SQS queue lives and where this provider Lambda runs.
     */
    delegatedAdminAccountId: string;

    /**
     * SQS queue ARN to subscribe to the topic.
     */
    queueArn: string;
  };
  PhysicalResourceId?: string;
}

export const handler = async (
  event: OnEvent,
  ctx: unknown,
): Promise<{ PhysicalResourceId: string; Data: { Email?: string } }> => {
  log.info('Context:', JSON.stringify(ctx, null, 2));
  log.info('Event:', JSON.stringify(event, null, 2));
  if (event.RequestType === 'Delete') {
    return {
      PhysicalResourceId: event.PhysicalResourceId ?? 'DescribeAccountEmail',
      Data: {},
    };
  }
  if (
    !event.ResourceProperties?.topicName ||
    !event.ResourceProperties.accountId ||
    !event.ResourceProperties.region ||
    !event.ResourceProperties.delegatedAdminAccountId ||
    !event.ResourceProperties.queueArn
  ) {
    throw new Error(
      'topicName, accountId, region, delegatedAdminAccountId, and queueArn are required in the event',
    );
  }

  const { topicName, accountId, region, delegatedAdminAccountId, queueArn } = event.ResourceProperties;

  // IMPORTANT:
  // The subscription is created in the delegated admin account (where this Lambda runs).
  // TopicArn must refer to the *member account* topic.
  // Endpoint must refer to the *delegated admin account* SQS queue ARN.
  const result = await sns.send(
    new SubscribeCommand({
      Protocol: 'sqs',
      TopicArn: `arn:aws:sns:${region}:${accountId}:${topicName}`,
      Endpoint: queueArn,
    }),
  );
  log.info('Subscribe result:', JSON.stringify(result, null, 2));

  return {
    PhysicalResourceId:
      result.SubscriptionArn ?? `TopicSubscription-${delegatedAdminAccountId}-${accountId}-${topicName}`,
    Data: {},
  };
};
