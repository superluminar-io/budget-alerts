// test/lib/budget-alerts-stack.get-mail.test.ts

// We define sendMock here and inject it into the mocked OrganizationsClient.
// This avoids poking at OrganizationsClient.mock.instances, which breaks when
// the client is created at module load time and we call jest.clearAllMocks().
const sendMock = jest.fn();

jest.mock('@aws-sdk/client-organizations', () => {
  return {
    __esModule: true,
    OrganizationsClient: jest.fn(() => ({
      send: sendMock,
    })),
    DescribeAccountCommand: jest.fn(), // we only assert call args
  };
});

// Import AFTER the mock so the Lambda file uses our mocked client.
import { DescribeAccountCommand } from '@aws-sdk/client-organizations';
import { handler } from '../../lib/budget-alerts-stack.get-mail';

describe('DescribeAccountEmail custom resource handler', () => {
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

    // org is created at module load time, but Delete must not call send()
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns default PhysicalResourceId on Delete when none is provided', async () => {
    const event = {
      RequestType: 'Delete' as const,
    };

    const result = await handler(event, {});

    expect(result).toEqual({
      PhysicalResourceId: 'DescribeAccountEmail',
      Data: {},
    });

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('throws when AccountId is missing for Create', async () => {
    const event = {
      RequestType: 'Create' as const,
      ResourceProperties: {},
    };

    await expect(handler(event, {})).rejects.toThrow('AccountId is required in the event');

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('describes the account and returns the email for Create', async () => {
    const accountId = '123456789012';
    const event = {
      RequestType: 'Create' as const,
      ResourceProperties: {
        AccountId: accountId,
      },
    };

    // Mock AWS response from OrganizationsClient.send
    sendMock.mockResolvedValue({
      Account: {
        Email: 'owner@example.com',
      },
    });

    const result = await handler(event, {});

    expect(result).toEqual({
      PhysicalResourceId: `DescribeAccountEmail-${accountId}`,
      Data: {
        Email: 'owner@example.com',
      },
    });

    // Ensure we built the DescribeAccountCommand with the right input
    expect(DescribeAccountCommand).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((DescribeAccountCommand as unknown as jest.Mock).mock.calls[0][0]).toEqual({
      AccountId: accountId,
    });

    // Ensure send() was called once
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('also works for Update the same way as Create', async () => {
    const accountId = '999999999999';
    const event = {
      RequestType: 'Update' as const,
      ResourceProperties: {
        AccountId: accountId,
      },
    };

    sendMock.mockResolvedValue({
      Account: {
        Email: 'update-owner@example.com',
      },
    });

    const result = await handler(event, {});

    expect(result).toEqual({
      PhysicalResourceId: `DescribeAccountEmail-${accountId}`,
      Data: {
        Email: 'update-owner@example.com',
      },
    });

    expect(DescribeAccountCommand).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((DescribeAccountCommand as unknown as jest.Mock).mock.calls[0][0]).toEqual({
      AccountId: accountId,
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('throws a helpful error when the account has no email', async () => {
    const accountId = '111122223333';
    const event = {
      RequestType: 'Create' as const,
      ResourceProperties: {
        AccountId: accountId,
      },
    };

    sendMock.mockResolvedValue({
      Account: {}, // Email missing
    });

    await expect(handler(event, {})).rejects.toThrow(
      `Could not find account email for account ID: ${accountId}`,
    );

    expect(DescribeAccountCommand).toHaveBeenCalledWith({ AccountId: accountId });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
