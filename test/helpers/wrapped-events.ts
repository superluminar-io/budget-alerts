import type { SQSEvent } from 'aws-lambda';
import { parse as parseArn } from '@aws-sdk/util-arn-parser';

const NOW = '2026-01-28T12:00:00.000Z';

const snsEnvelope = (i: number, topicArn: string, body: Record<string, unknown>) => {
  const { region } = parseArn(topicArn);
  return JSON.stringify({
    ...body,
    TopicArn: topicArn,
    MessageId: `sns-${i}`,
    Timestamp: NOW,
    SignatureVersion: '1',
    Signature: `sig-${i}`,
    SigningCertURL: `https://sns.${region}.amazonaws.com/SimpleNotificationService.pem`,
  });
};

export interface SqsEventRecordInput {
  topicArn: string;
  type: 'Notification' | 'SubscriptionConfirmation';
  message?: string;
}

export const sqsEvent = (...records: SqsEventRecordInput[]): SQSEvent => ({
  Records: records.map((r, i) => {
    const { region, accountId } = parseArn(r.topicArn);

    const body =
      r.type === 'Notification'
        ? {
            Type: 'Notification',
            Subject: 'AWS Budgets: Budget threshold exceeded',
            Message:
              r.message ??
              `AWS Budget Notification\n\nAccount: ${accountId}\nBudget Name: chatbot-budget-${accountId.slice(-4)}-${i}\nThreshold: 80.00%\nACTUAL Amount: 123.45 EUR\nBUDGETED Amount: 150.00 EUR\n`,
            UnsubscribeURL: `https://sns.${region}.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:${region}:${accountId}:sub-${i}`,
          }
        : {
            Type: 'SubscriptionConfirmation',
            Token: `token-${i}`,
            Message: `You have chosen to subscribe to the topic ${r.topicArn}.\nTo confirm the subscription, visit the SubscribeURL included in this message.`,
            SubscribeURL: `https://sns.${region}.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(
              r.topicArn,
            )}&Token=token-${i}`,
          };

    return {
      messageId: `sqs-${i}`,
      receiptHandle: `rh-${i}`,
      body: snsEnvelope(i, r.topicArn, body),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: String(Date.parse(NOW)),
        SenderId: 'AIDAEXAMPLEFIXTURE',
        ApproximateFirstReceiveTimestamp: String(Date.parse(NOW)),
      },
      messageAttributes: {},
      md5OfBody: `md5-${i}`,
      eventSource: 'aws:sqs',
      eventSourceARN: `arn:aws:sqs:${region}:${accountId}:fixture-queue`,
      awsRegion: region,
    };
  }),
});
