// lib/org/org-discovery.ts
import {
  OrganizationsClient,
  ListRootsCommand,
  ListOrganizationalUnitsForParentCommand,
} from '@aws-sdk/client-organizations';

export interface OuNode {
  id: string;
  parentId: string | null;
  name: string;
}

export interface OrgRoot {
  id: string;
  name: string;
}

export interface OrgStructure {
  root: OrgRoot;
  ous: OuNode[];
}

/**
 * Recursively list all OUs under the organization root.
 * This is pure discovery; no config logic here.
 */
export async function loadOrgStructure(): Promise<OrgStructure> {
  const client = new OrganizationsClient({});

  const rootsResp = await client.send(new ListRootsCommand({}));
  const root = rootsResp.Roots?.[0];
  if (!root?.Id || !root.Name) {
    throw new Error('Could not find organization root');
  }

  async function listChildren(parentId: string): Promise<OuNode[]> {
    const ous: OuNode[] = [];
    let nextToken: string | undefined;

    do {
      const resp = await client.send(
        new ListOrganizationalUnitsForParentCommand({
          ParentId: parentId,
          NextToken: nextToken,
        }),
      );

      for (const ou of resp.OrganizationalUnits ?? []) {
        if (!ou.Id || !ou.Name) continue;

        ous.push({
          id: ou.Id,
          name: ou.Name,
          parentId,
        });

        const childOus = await listChildren(ou.Id);
        ous.push(...childOus);
      }

      nextToken = resp.NextToken;
    } while (nextToken);

    return ous;
  }

  const ous = await listChildren(root.Id);

  return {
    root: { id: root.Id, name: root.Name },
    ous,
  };
}
