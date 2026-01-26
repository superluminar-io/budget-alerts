/* eslint-disable @typescript-eslint/no-empty-function */
import { handler } from '../../lib/budget-alerts-stack.forward-sns-message';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { mockClient } from 'aws-sdk-client-mock';
import type { SNSEvent, Context } from 'aws-lambda';

const snsMock = mockClient(SNSClient);

describe('forward-sns-message Lambda', () => {
  const originalEnv = process.env;
  const TARGET_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:target-topic';

  beforeEach(() => {
    snsMock.reset();
    process.env = { ...originalEnv };
    process.env.TARGET_SNS_TOPIC_ARN = TARGET_TOPIC_ARN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const createMockContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2024/01/01/[$LATEST]test',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  const createSNSEvent = (messageCount = 1): SNSEvent => {
    const records = [];
    for (let i = 0; i < messageCount; i++) {
      records.push({
        EventVersion: '1.0',
        EventSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:source-topic:subscription-id',
        EventSource: 'aws:sns',
        Sns: {
          SignatureVersion: '1',
          Timestamp: '2024-01-01T00:00:00.000Z',
          Signature: 'test-signature',
          SigningCertUrl: 'https://sns.us-east-1.amazonaws.com/cert.pem',
          MessageId: `message-id-${i}`,
          Message: `Test message ${i}`,
          MessageAttributes: {
            attribute1: {
              Type: 'String',
              Value: 'value1',
            },
            attribute2: {
              Type: 'Number',
              Value: '123',
            },
          },
          Type: 'Notification',
          UnsubscribeUrl: 'https://sns.us-east-1.amazonaws.com/unsubscribe',
          TopicArn: 'arn:aws:sns:us-east-1:123456789012:source-topic',
          Subject: `Test Subject ${i}`,
        },
      });
    }
    return { Records: records };
  };

  describe('successful message forwarding', () => {
    it('should forward a single SNS message to the target topic', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'new-message-id' });

      const event = createSNSEvent(1);
      const context = createMockContext();

      await handler(event, context);

      expect(snsMock.calls()).toHaveLength(1);
      const call = snsMock.call(0);
      expect(call.args[0].input).toEqual({
        TopicArn: TARGET_TOPIC_ARN,
        Message: 'Test message 0',
        Subject: 'Test Subject 0',
        MessageAttributes: {
          attribute1: {
            DataType: 'String',
            StringValue: 'value1',
          },
          attribute2: {
            DataType: 'Number',
            StringValue: '123',
          },
        },
      });
    });

    it('should forward multiple SNS messages in parallel', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'new-message-id' });

      const event = createSNSEvent(3);
      const context = createMockContext();

      await handler(event, context);

      expect(snsMock.calls()).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        const call = snsMock.call(i);
        expect(call.args[0].input).toMatchObject({
          TopicArn: TARGET_TOPIC_ARN,
          Message: `Test message ${i}`,
          Subject: `Test Subject ${i}`,
        });
      }
    });

    it('should handle messages without a subject', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'new-message-id' });

      const event = createSNSEvent(1);
      delete event.Records[0].Sns.Subject;
      const context = createMockContext();

      await handler(event, context);

      expect(snsMock.calls()).toHaveLength(1);
      const call = snsMock.call(0);
      expect(call.args[0].input).toMatchObject({
        TopicArn: TARGET_TOPIC_ARN,
        Message: 'Test message 0',
        Subject: undefined,
      });
    });

    it('should handle messages with empty MessageAttributes', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'new-message-id' });

      const event = createSNSEvent(1);
      event.Records[0].Sns.MessageAttributes = {};
      const context = createMockContext();

      await handler(event, context);

      expect(snsMock.calls()).toHaveLength(1);
      const call = snsMock.call(0);
      expect(call.args[0].input).toMatchObject({
        TopicArn: TARGET_TOPIC_ARN,
        Message: 'Test message 0',
        MessageAttributes: {},
      });
    });
  });

  describe('error handling', () => {
    it('should throw error when TARGET_SNS_TOPIC_ARN is not set', async () => {
      delete process.env.TARGET_SNS_TOPIC_ARN;

      const event = createSNSEvent(1);
      const context = createMockContext();

      await expect(handler(event, context)).rejects.toThrow(
        'TARGET_SNS_TOPIC_ARN environment variable is not set',
      );

      expect(snsMock.calls()).toHaveLength(0);
    });

    it('should throw error when SNS publish fails', async () => {
      snsMock.on(PublishCommand).rejects(new Error('SNS publish failed'));

      const event = createSNSEvent(1);
      const context = createMockContext();

      await expect(handler(event, context)).rejects.toThrow('SNS publish failed');

      expect(snsMock.calls()).toHaveLength(1);
    });

    it('should fail all messages if one fails in batch', async () => {
      snsMock
        .on(PublishCommand)
        .resolvesOnce({ MessageId: 'success-1' })
        .rejectsOnce(new Error('Failed message'))
        .resolvesOnce({ MessageId: 'success-3' });

      const event = createSNSEvent(3);
      const context = createMockContext();

      await expect(handler(event, context)).rejects.toThrow('Failed message');

      expect(snsMock.calls()).toHaveLength(3);
    });
  });

  describe('message attribute conversion', () => {
    it('should correctly convert different message attribute types', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'new-message-id' });

      const event = createSNSEvent(1);
      event.Records[0].Sns.MessageAttributes = {
        stringAttr: {
          Type: 'String',
          Value: 'test-string',
        },
        numberAttr: {
          Type: 'Number',
          Value: '42',
        },
        binaryAttr: {
          Type: 'Binary',
          Value: 'dGVzdA==',
        },
      };

      const context = createMockContext();
      await handler(event, context);

      expect(snsMock.calls()).toHaveLength(1);
      const call = snsMock.call(0);
      // Cast to PublishCommand to access the input
      const command = call.args[0] as PublishCommand;
      expect(command.input.MessageAttributes).toEqual({
        stringAttr: {
          DataType: 'String',
          StringValue: 'test-string',
        },
        numberAttr: {
          DataType: 'Number',
          StringValue: '42',
        },
        binaryAttr: {
          DataType: 'Binary',
          StringValue: 'dGVzdA==',
        },
      });
    });
  });
});
