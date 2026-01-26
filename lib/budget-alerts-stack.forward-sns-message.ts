import { SNSClient, PublishCommand, type MessageAttributeValue } from '@aws-sdk/client-sns';
import { type SNSEvent, type SNSEventRecord, type Context } from 'aws-lambda';

const snsClient = new SNSClient({});

import log from 'loglevel';

log.setLevel('info');

/**
 * Lambda handler that forwards SNS messages to another SNS topic
 * @param event - SNS event containing one or more SNS messages
 * @param context - Lambda context
 */
export async function handler(event: SNSEvent, _context: Context): Promise<void> {
  log.info('Received SNS event:', JSON.stringify(event, null, 2));

  const TARGET_SNS_TOPIC_ARN = process.env.TARGET_SNS_TOPIC_ARN;

  if (!TARGET_SNS_TOPIC_ARN) {
    throw new Error('TARGET_SNS_TOPIC_ARN environment variable is not set');
  }

  // Process all SNS records in the event
  const publishPromises = event.Records.map((record: SNSEventRecord) =>
    forwardMessage(record, TARGET_SNS_TOPIC_ARN),
  );

  try {
    await Promise.all(publishPromises);
    log.info(
      `Successfully forwarded ${publishPromises.length} message(s) to ${TARGET_SNS_TOPIC_ARN}`,
    );
  } catch (error) {
    log.error('Error forwarding messages:', error);
    throw error;
  }
}

/**
 * Forward a single SNS message to the target topic
 * @param record - SNS event record
 * @param targetTopicArn - ARN of the target SNS topic
 */
async function forwardMessage(record: SNSEventRecord, targetTopicArn: string): Promise<void> {
  const snsMessage = record.Sns;

  log.info(`Forwarding message with ID: ${snsMessage.MessageId}`);

  // Convert SNS message attributes to the format expected by AWS SDK v3
  const messageAttributes: Record<string, MessageAttributeValue> = {};
  for (const [key, value] of Object.entries(snsMessage.MessageAttributes)) {
    messageAttributes[key] = {
      DataType: value.Type,
      StringValue: value.Value,
    };
  }

  const publishCommand = new PublishCommand({
    TopicArn: targetTopicArn,
    Message: snsMessage.Message,
    Subject: snsMessage.Subject,
    MessageAttributes: messageAttributes,
  });

  try {
    const response = await snsClient.send(publishCommand);
    log.info(`Message forwarded successfully. New MessageId: ${response.MessageId}`);
  } catch (error) {
    log.error(`Failed to forward message ${snsMessage.MessageId}:`, error);
    throw error;
  }
}
