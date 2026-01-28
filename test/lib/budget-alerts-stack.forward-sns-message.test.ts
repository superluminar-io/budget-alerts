/* eslint-disable @typescript-eslint/no-empty-function */
import { handler } from '../../lib/budget-alerts-stack.forward-sns-message';
import { SNSClient, PublishCommand, ConfirmSubscriptionCommand } from '@aws-sdk/client-sns';
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
        body: '{\n "Type" : "Notification",\n "MessageId" : "d7eac51f-e9b1-5584-b17f-a4ec13707c7d",\n "TopicArn" : "arn:aws:sns:eu-west-1:391613010373:budget-alerts",\n "Subject" : "AWS Budgets: test has exceeded your alert threshold",\n "Message" : "AWS Budget Notification January 28, 2026\\nAWS Account 391613010373\\n\\nDear AWS Customer,\\n\\nYou requested that we alert you when the FORECASTED Cost associated with your test budget is greater than $0.00 for the current month. The FORECASTED Cost associated with this budget is $0.95. You can find additional details below and by accessing the AWS Budgets dashboard [1].\\n\\nBudget Name: test\\nBudget Type: Cost\\nBudgeted Amount: $0.02\\nAlert Type: FORECASTED\\nAlert Threshold: > $0.00\\nFORECASTED Amount: $0.95\\n\\n[1] https://console.aws.amazon.com/costmanagement/home#/budgets\\n",\n "Timestamp" : "2026-01-28T11:52:33.584Z",\n "SignatureVersion" : "1",\n "Signature" : "E6D5lCzdLmEwGIEYgjyV0mD2jLS9L5sE8rWH5vgNlusFVmeFhcB760/AzXUAr0Rv6RPON4DML0KaRJkoRpcRCs4Z1xPVNAEguolF9pWy05b+C0zy8jX17lydqN4GYRuqFhrn8xnkSyWquAlfjjtKyR6G7MdLwmcaejnFOVdtftjSOrH8l7YMU2z494GpDbn4c1TnCxm4wKZ5jsJmkIMoQQZSX7RGQ4Y1ydP0mMhMkSB9Sc4Y7rSlBqomB1Tm5Q0P1M+aJ24qZ35knV0GuJ8Ho+Bj1slG9w6JzZyBXwLQWymh+h43jz8s+XysJIkkr2s1Utz3OaFsUc6GDFdRnuyL3w==",\n "SigningCertURL" : "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-7506a1e35b36ef5a444dd1a8e7cc3ed8.pem",\n "UnsubscribeURL" : "https://sns.eu-west-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:eu-west-1:391613010373:budget-alerts:56c1b69b-5fd3-4751-8452-f15e03766be2"\n}',
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
      expect(call.args[0].input).toMatchObject({
        TopicArn: TARGET_TOPIC_ARN,
        Subject: 'AWS Budgets: test has exceeded your alert threshold',
        Message: `AWS Budget Notification January 28, 2026
AWS Account 391613010373

Dear AWS Customer,

You requested that we alert you when the FORECASTED Cost associated with your test budget is greater than $0.00 for the current month. The FORECASTED Cost associated with this budget is $0.95. You can find additional details below and by accessing the AWS Budgets dashboard [1].

Budget Name: test
Budget Type: Cost
Budgeted Amount: $0.02
Alert Type: FORECASTED
Alert Threshold: > $0.00
FORECASTED Amount: $0.95

[1] https://console.aws.amazon.com/costmanagement/home#/budgets
`,
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

          Subject: `AWS Budgets: Budget threshold exceeded`,
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

describe('subscription confirmation handling', () => {
  const TARGET_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:target-topic';

  beforeEach(() => {
    snsMock.reset();
    process.env.TARGET_SNS_TOPIC_ARN = TARGET_TOPIC_ARN;
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

  const createSubscriptionConfirmationSQSEvent = (): SQSEvent => {
    const body = JSON.stringify({
      Type: 'SubscriptionConfirmation',
      MessageId: '11111111-2222-3333-4444-555555555555',
      Token: 'example-token',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:source-topic',
      Message: 'You have chosen to subscribe to the topic.',
      SubscribeURL:
        'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:us-east-1:123456789012:source-topic&Token=example-token',
      Timestamp: '2026-01-28T11:52:33.584Z',
      SignatureVersion: '1',
      Signature: 'signature',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-12345.pem',
    });

    return {
      Records: [
        {
          messageId: 'sub-confirm-message-id',
          receiptHandle: 'handle',
          body,
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1769601153617',
            SenderId: 'AIDAISMY7JYY5F7RTT6AO',
            ApproximateFirstReceiveTimestamp: '1769601153631',
          },
          messageAttributes: {},
          md5OfBody: 'md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test',
          awsRegion: 'us-east-1',
        },
      ],
    } as SQSEvent;
  };

  it('should confirm subscription when receiving SubscriptionConfirmation message', async () => {
    const context = createMockContext();

    // ConfirmSubscription success
    snsMock.on(ConfirmSubscriptionCommand).resolves({
      SubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:source-topic:sub-arn',
    });

    const event = createSubscriptionConfirmationSQSEvent();
    await handler(event, context);

    // No publish calls should be made, only a confirmation
    const calls = snsMock.calls();
    expect(calls).toHaveLength(1);
    const call = snsMock.call(0);
    expect(call.args[0]).toBeInstanceOf(ConfirmSubscriptionCommand);
    expect(call.args[0].input).toMatchObject({
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:source-topic',
      Token: 'example-token',
    });
  });

  it('should propagate error when subscription confirmation fails', async () => {
    const context = createMockContext();

    // ConfirmSubscription failure
    snsMock.on(ConfirmSubscriptionCommand).rejects(new Error('confirm failed'));

    const event = createSubscriptionConfirmationSQSEvent();
    await expect(handler(event, context)).rejects.toThrow('confirm failed');

    const calls = snsMock.calls();
    expect(calls).toHaveLength(1);
    const call = snsMock.call(0);
    expect(call.args[0]).toBeInstanceOf(ConfirmSubscriptionCommand);
  });
});
