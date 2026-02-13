// We define sendMock here and inject it into the mocked SNSClient.
// This avoids poking at SNSClient.mock.instances, which breaks when
// the client is created at module load time and we call jest.clearAllMocks().
const sendMock = jest.fn();

jest.mock('@aws-sdk/client-sns', () => {
  return {
    __esModule: true,
    SNSClient: jest.fn(() => ({
      send: sendMock,
    })),
    SubscribeCommand: jest.fn(), // we only assert call args
    UnsubscribeCommand: jest.fn(), // we only assert call args
  };
});

// Import AFTER the mock so the Lambda file uses our mocked client.
import { SubscribeCommand, UnsubscribeCommand } from '@aws-sdk/client-sns';
import { handler } from '../../lib/budget-alerts-stack.subscribe-sqs';

describe('SubscribeSqs custom resource handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns existing PhysicalResourceId and empty Data on Delete without calling AWS', async () => {
    const event = {
      RequestType: 'Delete' as const,
      PhysicalResourceId: 'ExistingResourceId',
    };

    const result = await handler(event, {});

    expect(result).toEqual({
      PhysicalResourceId: 'ExistingResourceId',
      Data: {},
    });

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('throws when required base properties are missing', async () => {
    const event = {
      RequestType: 'Create' as const,
      // Cast to any to intentionally violate the ResourceProperties contract.
      // This ensures we test the runtime input validation.
      ResourceProperties: {} as any,
    };

    await expect(handler(event, {})).rejects.toThrow(
      'topicName, accountId, and region are required in the event',
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('subscribes using legacy properties (derives queueArn and uses accountId as topic owner)', async () => {
    const event = {
      RequestType: 'Create' as const,
      // Cast to any to allow testing backwards-compatible legacy property sets.
      ResourceProperties: {
        topicName: 'budget-alerts',
        accountId: '111111111111',
        region: 'eu-central-1',
      } as any,
    };

    sendMock.mockResolvedValue({
      SubscriptionArn: 'arn:aws:sns:eu-central-1:111111111111:budget-alerts:sub',
    });

    const result = await handler(event, {});

    expect(result).toEqual({
      PhysicalResourceId: 'arn:aws:sns:eu-central-1:111111111111:budget-alerts:sub',
      Data: {
        SubscriptionArn: 'arn:aws:sns:eu-central-1:111111111111:budget-alerts:sub',
      },
    });

    expect(SubscribeCommand).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((SubscribeCommand as unknown as jest.Mock).mock.calls[0][0]).toEqual({
      Protocol: 'sqs',
      TopicArn: 'arn:aws:sns:eu-central-1:111111111111:budget-alerts',
      Endpoint: 'arn:aws:sqs:eu-central-1:111111111111:budget-alerts-queue',
      Attributes: {
        RawMessageDelivery: 'true',
      },
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('subscribes using new properties (queueArn + delegatedAdminAccountId)', async () => {
    const event = {
      RequestType: 'Create' as const,
      ResourceProperties: {
        topicName: 'budget-alerts',
        accountId: '222222222222',
        region: 'eu-central-1',
        delegatedAdminAccountId: '999999999999',
        queueArn: 'arn:aws:sqs:eu-central-1:222222222222:custom-queue',
      },
    };

    sendMock.mockResolvedValue({
      SubscriptionArn: 'arn:aws:sns:eu-central-1:999999999999:budget-alerts:sub',
    });

    const result = await handler(event, {});

    expect(result).toEqual({
      PhysicalResourceId: 'arn:aws:sns:eu-central-1:999999999999:budget-alerts:sub',
      Data: {
        SubscriptionArn: 'arn:aws:sns:eu-central-1:999999999999:budget-alerts:sub',
      },
    });

    expect(SubscribeCommand).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((SubscribeCommand as unknown as jest.Mock).mock.calls[0][0]).toEqual({
      Attributes: {
        RawMessageDelivery: 'true',
      },
      Protocol: 'sqs',
      TopicArn: 'arn:aws:sns:eu-central-1:999999999999:budget-alerts',
      Endpoint: 'arn:aws:sqs:eu-central-1:222222222222:custom-queue',
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on Delete when SubscriptionArn is present', async () => {
    const event = {
      RequestType: 'Delete' as const,
      PhysicalResourceId: 'arn:aws:sns:eu-central-1:111111111111:budget-alerts:sub',
      Data: {
        SubscriptionArn: 'arn:aws:sns:eu-central-1:111111111111:budget-alerts:sub',
      },
    };

    sendMock.mockResolvedValue({});

    const result = await handler(event, {});

    expect(result).toEqual({
      PhysicalResourceId: 'arn:aws:sns:eu-central-1:111111111111:budget-alerts:sub',
      Data: {},
    });

    expect(UnsubscribeCommand).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((UnsubscribeCommand as unknown as jest.Mock).mock.calls[0][0]).toEqual({
      SubscriptionArn: 'arn:aws:sns:eu-central-1:111111111111:budget-alerts:sub',
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
