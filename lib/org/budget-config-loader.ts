// lib/org/budget-config-loader.ts

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as yamlParse } from 'yaml';
import {
  DEFAULT_CURRENCY,
  DEFAULT_THRESHOLDS,
  DISABLED_CURRENCY,
  type BudgetConfig,
  type NullableSome,
} from './budget-config';

function isNullableBudgetConfig(
  value: unknown,
): value is NullableSome<BudgetConfig, 'organizationalUnits' | 'default'> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  //
  // Step 0: Ensure at least one of `organizationalUnits` or `default` exists
  //
  if (!('organizationalUnits' in value) && !('default' in value)) {
    return false;
  }

  // return false if default and organizationalUnits are both null or undefined
  if (
    (!('default' in value) || !(value as Record<string, unknown>).default) &&
    (!('organizationalUnits' in value) || !(value as Record<string, unknown>).organizationalUnits)
  ) {
    return false;
  }

  //
  // Step 1: Check `default` exists and is an object
  //
  if ('default' in value && value.default) {
    const def = (value as Record<string, unknown>).default;
    if (typeof def !== 'object' || def === null) {
      return false;
    }
    //
    // Step 2: Validate default.amount
    //
    const amount = (def as Record<string, unknown>).amount;
    if (amount && typeof amount !== 'number') {
      return false;
    }

    //
    // Step 3: Validate default.currency
    //
    const currency = (def as Record<string, unknown>).currency;
    if (typeof currency !== 'string') {
      return false;
    }

    //
    //Step 4: Validate default.aggregationSnsTopicArn
    //
    const snsTopicArn = (def as Record<string, unknown>).aggregationSnsTopicArn;
    if (snsTopicArn && typeof snsTopicArn !== 'string') {
      return false;
    }
  }

  //
  // Step 4: Validate organizationalUnits exists and is an object
  //
  if ('organizationalUnits' in value) {
    const ous = (value as Record<string, unknown>).organizationalUnits;
    if (ous && typeof ous !== 'object') {
      return false;
    }
  }

  //
  // Step 5: Validate sns topic arn in default
  //

  // We intentionally do not validate entries here
  return true;
}

function isBudgetConfig(value: unknown): value is BudgetConfig {
  if (!isNullableBudgetConfig(value)) {
    return false;
  }

  if (value.default === null) {
    return false;
  }

  return true;
}

export function sanitizeBudgetConfig(
  config: NullableSome<BudgetConfig, 'default' | 'organizationalUnits'>,
): BudgetConfig {
  const sanitized = { ...config, default: config.default ?? { currency: DISABLED_CURRENCY } };
  sanitized.default.thresholds ??= DEFAULT_THRESHOLDS;
  sanitized.default.currency ??= DEFAULT_CURRENCY;
  // loop over organizationalUnits and fill in missing fields
  if (sanitized.organizationalUnits) {
    for (const [ouId, entry] of Object.entries(sanitized.organizationalUnits)) {
      if (!entry || entry.off === true) {
        sanitized.organizationalUnits[ouId] = {
          off: true,
          amount: null,
        };
        continue;
      }
      entry.thresholds ??= DEFAULT_THRESHOLDS;
      entry.currency ??= DEFAULT_CURRENCY;
    }
  }
  if (isBudgetConfig(sanitized)) {
    return sanitized;
  }
  throw new Error('Invalid budget config structure');
}

/**
 * Load the budget config YAML from disk and return a typed BudgetConfig.
 *
 * - `configPath` is relative to the project root (CDK usually runs with cwd = root).
 * - Fails fast with a clear error if file is missing or malformed.
 */
export function loadBudgetConfig(configPath = 'budget-config.yaml'): BudgetConfig {
  const fullPath = resolve(configPath);

  if (!existsSync(fullPath)) {
    throw new Error(
      `Budget config file not found at ${fullPath}. ` +
        `Run "npm run budget:init" first to generate it.`,
    );
  }

  const raw = readFileSync(fullPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = yamlParse(raw);
  } catch (err) {
    throw new Error(`Failed to parse budget config YAML at ${fullPath}`, {cause: err});
  }

  if (!isNullableBudgetConfig(parsed)) {
    throw new Error(
      `Invalid budget config structure in ${fullPath}. ` +
        `Check "default" and "organizationalUnits" blocks.`,
    );
  }

  return sanitizeBudgetConfig(parsed);
}
