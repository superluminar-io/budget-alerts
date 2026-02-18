import { SNSClient, SubscribeCommand, UnsubscribeCommand } from '@aws-sdk/client-sns';
import log from 'loglevel';

log.setLevel(log.levels.INFO);

const sns = new SNSClient({});

export interface OnEvent {
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
): Promise<{ PhysicalResourceId: string; Data: { Email?: string; SubscriptionArn?: string } }> => {
  log.info('Context:', JSON.stringify(ctx, null, 2));
  log.info('Event:', JSON.stringify(event, null, 2));
  if (event.RequestType === 'Delete') {
    const subscriptionArn = (event as unknown as { Data?: { SubscriptionArn?: string } }).Data
      ?.SubscriptionArn;

    if (subscriptionArn) {
      const unsubResult = await sns.send(
        new UnsubscribeCommand({
          SubscriptionArn: subscriptionArn,
        }),
      );
      log.info('Unsubscribe result:', JSON.stringify(unsubResult, null, 2));
    }

    return {
      PhysicalResourceId: event.PhysicalResourceId ?? 'DescribeAccountEmail',
      Data: {},
    };
  }
  const props = event.ResourceProperties;

  // Support both the old property contract (topicName/accountId/region) and the newer one
  // (topicName/accountId/region/delegatedAdminAccountId/queueArn).
  const topicName = props?.topicName;
  const accountId = props?.accountId;
  const region = props?.region;

  const queueArnFromEvent = props?.queueArn;

  if (!topicName || !accountId || !region) {
    throw new Error('topicName, accountId, and region are required in the event');
  }

  // If queueArn is explicitly provided, use it. Otherwise derive it using the historic convention.
  const queueArn = queueArnFromEvent ?? `arn:aws:sqs:${region}:${accountId}:${topicName}-queue`;

  // Prefer delegatedAdminAccountId for the topic owner when provided (the provider runs in that
  // account), otherwise fall back to the member account for backwards compatibility.
  const topicOwnerAccountId = accountId;

  const result = await sns.send(
    new SubscribeCommand({
      Protocol: 'sqs',
      TopicArn: `arn:aws:sns:${region}:${topicOwnerAccountId}:${topicName}`,
      Endpoint: queueArn,
      // Cross-account SNS->SQS subscriptions remain in PendingConfirmation unless the subscription is
      // created with RawMessageDelivery and the queue policy allows sns.amazonaws.com with a matching
      // aws:SourceArn.
      Attributes: {
        RawMessageDelivery: 'true',
      },
    }),
  );
  log.info('Subscribe result:', JSON.stringify(result, null, 2));

  return {
    PhysicalResourceId: result.SubscriptionArn ?? `TopicSubscription-${accountId}-${topicName}`,
    Data: {
      SubscriptionArn: result.SubscriptionArn,
    },
  };
};
