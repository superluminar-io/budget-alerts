import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { type SQSEvent, type Context, type SQSRecord } from 'aws-lambda';

const snsClient = new SNSClient({});

import log from 'loglevel';

log.setLevel('debug');

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
    return forwardMessage(record.body, targetSnsTopicArn);
  });

  try {
    await Promise.all(promises);
    log.debug(`Successfully forwarded ${promises.length} message(s) to ${targetSnsTopicArn}`);
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
async function forwardMessage(record: string, targetTopicArn: string): Promise<void> {
  const publishCommand = new PublishCommand({
    TopicArn: targetTopicArn,
    Message: JSON.stringify(toChatBotMessage(record)),
    Subject: 'Budget Alert',
  });

  try {
    const response = await snsClient.send(publishCommand);
    log.debug(`Message forwarded successfully. New MessageId: ${response.MessageId}`);
  } catch (error) {
    log.error(`Failed to forward message`, error);
    throw error;
  }
}

function toChatBotMessage(message: string): BudgetAlertMessage {
  return {
    version: '1.0',
    source: 'custom',
    content: {
      textType: 'client-markdown',
      title: 'AWS Budget Alert',
      description: message,
      keywords: ['budget', 'alert', 'aws'],
    },
  };
}

interface BudgetAlertMessage {
  version: '1.0';
  source: 'custom';
  content: {
    textType: 'client-markdown';
    title: 'AWS Budget Alert';
    description: string;
    nextSteps?: string[];
    keywords: string[];
  };
}
