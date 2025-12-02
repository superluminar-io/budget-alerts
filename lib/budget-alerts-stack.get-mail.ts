import { DescribeAccountCommand, OrganizationsClient } from '@aws-sdk/client-organizations';
import log from 'loglevel';

const org = new OrganizationsClient({});

interface OnEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties?: { AccountId?: string };
  PhysicalResourceId?: string;
}

const getMail = async (
  organizationClient: OrganizationsClient,
  accountId: string,
): Promise<string> => {
  const account = await organizationClient.send(
    new DescribeAccountCommand({ AccountId: accountId }),
  );
  if (!account.Account?.Email) {
    throw new Error(`Could not find account email for account ID: ${accountId}`);
  }
  return account.Account.Email;
};

export const handler = async (
  event: OnEvent,
  ctx: unknown,
): Promise<{ PhysicalResourceId: string; Data: { Email?: string } }> => {
  log.info('Context:', JSON.stringify(ctx, null, 2));
  if (event.RequestType === 'Delete') {
    return {
      PhysicalResourceId: event.PhysicalResourceId ?? 'DescribeAccountEmail',
      Data: {},
    };
  }
  if (!event.ResourceProperties?.AccountId) {
    throw new Error('AccountId is required in the event');
  }
  const accountId = event.ResourceProperties.AccountId;
  const email = await getMail(org, accountId);
  return { PhysicalResourceId: `DescribeAccountEmail-${accountId}`, Data: { Email: email } };
};
