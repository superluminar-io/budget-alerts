import { SNSClient, PublishCommand, ConfirmSubscriptionCommand } from '@aws-sdk/client-sns';
import { type SQSEvent, type Context, type SQSRecord } from 'aws-lambda';

const snsClient = new SNSClient({});

import log from 'loglevel';

log.setLevel('debug');

// NOT provided by aws-lambda
interface SNSSubscriptionConfirmation {
  Type: 'SubscriptionConfirmation';
  MessageId: string;
  Token: string;
  TopicArn: string;
  Message: string;
  SubscribeURL: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
}

interface SNSNotification {
  Type: 'Notification';
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string; // often JSON *string*
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  UnsubscribeURL: string;
}

type SNSMessage = SNSSubscriptionConfirmation | SNSNotification;

function isSubscriptionConfirmation(message: SNSMessage): message is SNSSubscriptionConfirmation {
  return message.Type === 'SubscriptionConfirmation';
}

function isNotification(message: SNSMessage): message is SNSNotification {
  return message.Type === 'Notification';
}

/**
 * Lambda handler that forwards SNS messages to another SNS topic
 * @param event - SNS event containing one or more SNS messages
 * @param context - Lambda context
 */
export async function handler(event: SQSEvent, _context: Context): Promise<void> {
  log.debug('Received SQS event:', JSON.stringify(event, null, 2));

  const targetSnsTopicArn = process.env.TARGET_SNS_TOPIC_ARN;

  if (!targetSnsTopicArn) {
    throw new Error('TARGET_SNS_TOPIC_ARN environment variable is not set');
  }

  const promises = event.Records.map(async (record: SQSRecord) => {
    log.debug('Processing SQS record:', JSON.stringify(record, null, 2));
    const snsMessage = JSON.parse(record.body) as SNSMessage;
    log.debug('Parsed SNS message:', JSON.stringify(snsMessage, null, 2));

    if (isSubscriptionConfirmation(snsMessage)) {
      return confirmSubscription(snsMessage);
    } else if (isNotification(snsMessage)) {
      return forwardMessage(snsMessage, targetSnsTopicArn);
    }
  });

  try {
    await Promise.all(promises);
    log.debug(`Successfully forwarded ${promises.length} message(s) to ${targetSnsTopicArn}`);
  } catch (error) {
    log.error('Error forwarding messages:', error);
    throw error;
  }
}

async function confirmSubscription(snsMessage: SNSSubscriptionConfirmation): Promise<void> {
  log.debug('Confirming SNS subscription:', JSON.stringify(snsMessage, null, 2));

  const confirmCommand = new ConfirmSubscriptionCommand({
    TopicArn: snsMessage.TopicArn,
    Token: snsMessage.Token,
  });

  try {
    const response = await snsClient.send(confirmCommand);
    log.debug(`Subscription confirmed successfully. SubscriptionArn: ${response.SubscriptionArn}`);
  } catch (error) {
    log.error(`Failed to confirm subscription for TopicArn ${snsMessage.TopicArn}:`, error);
    throw error;
  }
}

/**
 * Forward a single SNS message to the target topic
 * @param record - SNS event record
 * @param targetTopicArn - ARN of the target SNS topic
 */
async function forwardMessage(record: SNSNotification, targetTopicArn: string): Promise<void> {
  const snsMessage = record;
  log.debug('Forwarding SQS message:', JSON.stringify(record, null, 2));

  log.debug(`Forwarding message with ID: ${snsMessage.MessageId}`);

  const publishCommand = new PublishCommand({
    TopicArn: targetTopicArn,
    Message: snsMessage.Message,
    Subject: snsMessage.Subject,
  });

  try {
    const response = await snsClient.send(publishCommand);
    log.debug(`Message forwarded successfully. New MessageId: ${response.MessageId}`);
  } catch (error) {
    log.error(`Failed to forward message ${snsMessage.MessageId}:`, error);
    throw error;
  }
}
