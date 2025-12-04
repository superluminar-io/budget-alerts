#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import * as YAML from 'yaml';
import {
  DEFAULT_CURRENCY,
  type BudgetConfig,
  type OuBudgetConfigEntry,
} from '../lib/org/budget-config';
import { loadOrgStructure, type OrgRoot, type OuNode } from '../lib/org/org-discovery';
import log from 'loglevel';

log.setLevel(log.levels.INFO);

/**
 * Build a lookup map for OU metadata by ID, to use when adding comments.
 */
function indexOusById(ous: OuNode[]): Record<string, OuNode> {
  const map: Record<string, OuNode> = {};
  for (const ou of ous) {
    if (ou.id) {
      map[ou.id] = ou;
    }
  }
  return map;
}

/**
 * Load an existing budget-config.yaml if present.
 */
function loadExistingConfig(path: string): BudgetConfig | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  return YAML.parse(raw) as BudgetConfig;
}

/**
 * Merge live OU list with an existing BudgetConfig:
 *
 * - For existing OUs: keep their amount/currency as-is.
 * - For new OUs: create entries with amount: null.
 *
 * No OU metadata (names/parents) is stored in the config;
 * those are added later as YAML comments only.
 */
function buildOrMergeConfig(ous: OuNode[], existing: BudgetConfig | null): BudgetConfig {
  const config = existing ?? {
    default: {
      amount: 100,
      currency: DEFAULT_CURRENCY,
    },
    organizationalUnits: {},
  };

  config.organizationalUnits ??= {};

  for (const ou of ous) {
    if (!ou.id) continue;

    const existingEntry = config.organizationalUnits[ou.id];

    if (!existingEntry) {
      // New OU: create a fresh entry with no explicit budget
      const entry: OuBudgetConfigEntry = {
        amount: null,
      };
      config.organizationalUnits[ou.id] = entry;
    } else {
      // Existing OU: leave the entry unchanged (we don't store names/parents here)
      config.organizationalUnits[ou.id] = existingEntry;
    }
  }

  return config;
}

/**
 * Remove config entries for OUs that are no longer present in the org,
 * but only if `prune` is true.
 */
function pruneUnknownOus(config: BudgetConfig, knownOuIds: Set<string>, prune: boolean): void {
  config.organizationalUnits ??= {};
  const allIds = Object.keys(config.organizationalUnits);

  const unknownIds = allIds.filter((id) => !knownOuIds.has(id));

  if (unknownIds.length === 0) {
    return;
  }

  if (!prune) {
    log.error(
      `Config contains ${unknownIds.length.toString()} OU id(s) ` +
        `that are no longer in the organization: ${unknownIds.join(', ')}`,
    );

    log.error(
      'Run this script again with "--prune" to remove them automatically, ' +
        'or edit budget-config.yaml manually.',
    );
    return;
  }

  for (const id of unknownIds) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete config.organizationalUnits[id];
  }

  log.error(
    `Pruned ${unknownIds.length.toString()} OU id(s) from config: ${unknownIds.join(', ')}`,
  );
}

/**
 * Attach informational comments (OU name + parent) to the
 * `organizationalUnits` map entries in the YAML document.
 */
function addOuCommentsToDocument(
  doc: YAML.Document.Parsed | YAML.Document,
  root: OrgRoot,
  ous: OuNode[],
): void {
  const ouIndex = indexOusById(ous);

  const top = doc.contents as any; // YAMLMap
  if (!top || typeof top.get !== 'function') return;

  const ouMap = top.get('organizationalUnits', true);
  if (!ouMap || !Array.isArray(ouMap.items)) return;

  // 1) Add a comment to the "organizationalUnits" key itself with root info
  const orgUnitsPair = top.items.find((item: any) => item.key?.value === 'organizationalUnits');
  if (orgUnitsPair?.key) {
    const keyNode = orgUnitsPair.key as YAML.Scalar;
    keyNode.comment = `Root OU: ${root.name} (${root.id})`;
  }

  // 2) Existing per-OU comments (parent/name) stay as before
  for (const item of ouMap.items as any[]) {
    const keyNode = item.key as YAML.Scalar;
    if (typeof keyNode.value === 'undefined') continue;

    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const ouId = String(keyNode.value);
    const ouNode = ouIndex[ouId];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!ouNode) continue;

    const parent = ouNode.parentId ? ouIndex[ouNode.parentId] : undefined;

    const inlineComment = parent
      ? `Parent: ${parent.name} (${parent.id}), Name: ${ouNode.name}`
      : `Parent: ROOT, Name: ${ouNode.name}`;

    keyNode.comment = inlineComment;
  }
}

/**
 * CLI entrypoint:
 *
 *   ts-node tools/init-budget-config.ts [config-path]
 *
 * Default config path: ./budget-config.yaml
 */
async function main() {
  const args = process.argv.slice(2);
  const prune = args.includes('--prune');
  log.info('Initializing budget config...');
  const configPath = resolve('budget-config.yaml');

  log.error(`Using config path: ${configPath}`);

  log.error('Querying AWS Organizations for OUs...');
  const { root, ous } = await loadOrgStructure();
  log.error(`Found ${ous.length} OUs under root ${root.name} (${root.id}).`);

  const existing = loadExistingConfig(configPath);

  const knownOuIds = new Set(ous.map((o) => o.id));
  if (existing) {
    pruneUnknownOus(existing, knownOuIds, prune);
  }
  const merged = buildOrMergeConfig(ous, existing);

  const doc = new YAML.Document();
  doc.contents = doc.createNode(merged);

  addOuCommentsToDocument(doc, root, ous);

  const yamlText = String(doc);
  writeFileSync(configPath, yamlText, 'utf8');
  log.error(`Written budget config to ${configPath}`);

  const cdkJsonPath = resolve('cdk.json');
  writeFileSync(
    cdkJsonPath,
    JSON.stringify(
      {
        app: 'npx budget-alerts',
        context: {
          budgetConfigPath: 'budget-config.yaml',
          '@aws-cdk/aws-lambda-nodejs:useLatestRuntimeVersion': true,
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  log.error(`Written CDK app config to ${cdkJsonPath}`);
}

main().catch((err: unknown) => {
  log.error('Error during init-budget-config:', err);
  process.exit(1);
});
