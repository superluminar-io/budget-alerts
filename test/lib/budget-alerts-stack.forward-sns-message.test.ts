/* eslint-disable @typescript-eslint/no-empty-function */
import { handler } from '../../lib/budget-alerts-stack.forward-sns-message';
import { SNSClient, PublishCommand, type PublishCommandInput } from '@aws-sdk/client-sns';
import { mockClient } from 'aws-sdk-client-mock';
import type { Context, SQSEvent } from 'aws-lambda';
import { sqsEvent, type SqsEventRecordInput } from '../helpers/wrapped-events';

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

  const createDefaultSQSEvent = (messageCount = 1): SQSEvent => {
    return sqsEvent(
      ...Array.from(
        { length: messageCount },
        (_, i) =>
          ({
            type: 'Notification',
            topicArn: `arn:aws:sns:us-east-1:123456789012:source-topic-${i}`,
          }) as SqsEventRecordInput,
      ),
    );
  };

  const exampleEvent = {
    Records: [
      {
        messageId: '27fa4149-99e0-44cd-9caa-4b58263b30e3',
        receiptHandle:
          'AQEBvGRGKAPLqUjOS3bEg1ZZ0cz/Sz5NA+r5E/R3CEif0OruvDbd/On29JNHnwvzVRqWBFZoPd27R8DVeqvYyZ6G+zH7ZB0mg5v9RuraZdY34/dLD7dSmSMlQpzmi8lTGodLe/k+wRTjsEGRYs9jkaKtsx937+6b+rYIE4aT5ZzQK16eiux7AVFVBWcaBUdvHENvwGqu5iLodzOHiF/9hv6v5YbZMarM+KVwXObDeXt4QuVJVVA6eptTjoxck0Zi47f4i3Pq7n3fxNCYecTZ22wccsw/v1UW2/jxMJvSTu+Q4iIdW+68sqBU5gxCo+F8Fye5mFXTtiNSKgrdlGTMSlP94/eM6Q3jD/IN7vYPztV6s4Pq6CcAJUDZqUWjWpZfaWB6',
        body: 'AWS Budget Notification February 17, 2026\nAWS Account 084274240787\n\nDear AWS Customer,\n\nYou requested that we alert you when the ACTUAL Cost associated with your MonthlyBudget-eu-west-1-1770978414540-1X3bcZUWhcMp budget is greater than $0.50 for the current month. The ACTUAL Cost associated with this budget is $18.86. You can find additional details below and by accessing the AWS Budgets dashboard [1].\n\nBudget Name: MonthlyBudget-eu-west-1-1770978414540-1X3bcZUWhcMp\nBudget Type: Cost\nBudgeted Amount: $50.00\nAlert Type: ACTUAL\nAlert Threshold: > $0.50\nACTUAL Amount: $18.86\n\n[1] https://console.aws.amazon.com/costmanagement/home#/budgets\n',
        attributes: {
          ApproximateReceiveCount: '1',
          AWSTraceHeader:
            'Root=1-6979f881-f94f7eb49ae7be2706852902;Parent=57e7173ed78c191f;Sampled=0;Lineage=1:271d0be9:0',
          SentTimestamp: '1769601153617',
          SenderId: 'AIDAISMY7JYY5F7RTT6AO',
          ApproximateFirstReceiveTimestamp: '1769601153631',
        },
        messageAttributes: {},
        md5OfBody: 'add587d4631d758c912dad947c4a49d6',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:eu-west-1:391613010373:test',
        awsRegion: 'eu-west-1',
      },
    ],
  };

  describe('successful message forwarding', () => {
    it('should forward a single SNS message to the target topic', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'new-message-id' });

      const context = createMockContext();

      await handler(exampleEvent, context);

      expect(snsMock.calls()).toHaveLength(1);
      const call = snsMock.call(0);
      const input = call.args[0].input as PublishCommandInput;
      expect(input).toMatchObject({
        TopicArn: TARGET_TOPIC_ARN,
        Subject: 'Budget Alert',
        Message: expect.any(String) as unknown,
      });
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const publishedMessage = JSON.parse(input.Message!) as unknown;
      console.log('Published message:', JSON.stringify((publishedMessage as any).description, null, 2));
      expect(publishedMessage).toMatchObject({
        version: '1.0',
        source: 'custom',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        content: expect.objectContaining({
          textType: 'client-markdown',
          title: 'AWS Budget Alert',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          description: expect.stringMatching(/AWS Budget Notification.*\nAWS Account \d{12}\n\nDear AWS Customer,\n\nYou requested that we alert you when the ACTUAL Cost associated with your MonthlyBudget-\S+ budget is greater than \$\d+(\.\d{1,2})? for the current month\. The ACTUAL Cost associated with this budget is \$\d+(\.\d{1,2})?\. You can find additional details below and by accessing the AWS Budgets dashboard \[1\]\.\n\nBudget Name: MonthlyBudget\S+\nBudget Type: Cost\nBudgeted Amount: \$\d+(\.\d{1,2})?\nAlert Type: ACTUAL\nAlert Threshold: > \$\d+(\.\d{2})?\nACTUAL Amount: \$\d+(\.\d{2})\n\n\[1\] https:\/\/console.aws.amazon.com\/costmanagement\/home#\/budgets/),
        }),
      });
    });

    it('should forward multiple SNS messages in parallel', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'new-message-id' });

      const event = createDefaultSQSEvent(3);
      const context = createMockContext();

      await handler(event, context);

      expect(snsMock.calls()).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        const call = snsMock.call(i);
        expect(call.args[0].input).toMatchObject({
          TopicArn: TARGET_TOPIC_ARN,

          Subject: 'Budget Alert',
        });
      }
    });
  });

  describe('error handling', () => {
    it('should throw error when TARGET_SNS_TOPIC_ARN is not set', async () => {
      delete process.env.TARGET_SNS_TOPIC_ARN;
      const event = createDefaultSQSEvent(1);
      const context = createMockContext();
      await expect(handler(event, context)).rejects.toThrow(
        'TARGET_SNS_TOPIC_ARN environment variable is not set',
      );
      expect(snsMock.calls()).toHaveLength(0);
    });

    it('should throw error when SNS publish fails', async () => {
      snsMock.on(PublishCommand).rejects(new Error('SNS publish failed'));
      const event = createDefaultSQSEvent(1);
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
      const event = createDefaultSQSEvent(3);
      const context = createMockContext();
      await expect(handler(event, context)).rejects.toThrow('Failed message');
      expect(snsMock.calls()).toHaveLength(3);
    });
  });
});
