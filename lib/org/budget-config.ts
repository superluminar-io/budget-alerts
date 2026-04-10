export type Thresholds = readonly number[]; // e.g. [75, 100]

export const DEFAULT_THRESHOLDS: Thresholds = [75, 100] as const;
export const DEFAULT_CURRENCY = 'USD';

/**
 * Alert type for budget notifications
 * - 'actual': Alert based on actual spend
 * - 'forecasted': Alert based on forecasted spend
 */
export type AlertType = 'actual' | 'forecasted';

/**
 * Full alert configuration with threshold and type
 */
export interface AlertConfig {
  threshold: number;
  type: AlertType;
}

/**
 * Alert entry can be either:
 * - A number (shorthand for actual alert at that threshold)
 * - A full AlertConfig object
 */
export type AlertEntry = number | AlertConfig;

/**
 * Array of alert entries
 */
export type Alerts = readonly AlertEntry[];

/**
 * Default alerts configuration (75% and 100% actual spend)
 */
export const DEFAULT_ALERTS: Alerts = [75, 100] as const;

export interface OuBudgetConfigEntry {
  /**
   * Explicit budget amount for this OU.
   * null = "no explicit override" (use default or inheritance later).
   */
  amount: number | null;

  /**
   * Optional currency override.
   */
  currency?: string;

  /**
   * Percentage thresholds at which budget alerts will be triggered.
   * If omitted, the default thresholds ([75, 100]) will be used.
   * @deprecated Use `alerts` instead
   */
  thresholds?: Thresholds;

  /**
   * Alert configurations specifying threshold percentages and alert types.
   * Each alert can be either:
   * - A number (shorthand for actual alert at that threshold)
   * - An object with threshold and type ('actual' or 'forecasted')
   * If omitted, defaults to [75, 100] actual alerts.
   */
  alerts?: Alerts;

  /**
   * If true, this ou will not have a budget attached
   * If not specified, defaults to false
   */
  off?: boolean; // if true, budget is disabled for this OU

  /**
   * Optionally enable SNS topic for budget notifications for this OU.
   * If you want aggregation to a single SNS topic, also set aggregationSnsTopicArn in the default config.
   * Useful when you want to integrate Amazon Chatsbot with your budget notifications.
   */
  aggregationSnsTopicArn?: string | null;
}

export interface BudgetConfig {
  default: {
    amount?: number;
    currency?: string;
    /**
     * @deprecated Use `alerts` instead
     */
    thresholds?: Thresholds;
    /**
     * Alert configurations for default budget.
     * If omitted, defaults to [75, 100] actual alerts.
     */
    alerts?: Alerts;
    aggregationSnsTopicArn?: string;
  };

  /**
   * Flat map from OU ID -> budget settings.
   * We use Partial so that accesses like config.organizationalUnits[ouId]
   * naturally have type OuBudgetConfigEntry | undefined.
   */
  organizationalUnits?: Partial<Record<string, OuBudgetConfigEntry>>;
}

export type NullableSome<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? T[P] | null | undefined : T[P];
};

export const DISABLED_CURRENCY = 'NONE';

/**
 * Normalizes an alert entry to a full AlertConfig object.
 * - If the entry is a number, it's treated as an actual alert at that threshold
 * - If the entry is already an AlertConfig, it's returned as-is
 */
export function normalizeAlertEntry(entry: AlertEntry): AlertConfig {
  if (typeof entry === 'number') {
    return { threshold: entry, type: 'actual' };
  }
  return entry;
}

/**
 * Normalizes an alerts array to an array of AlertConfig objects.
 */
export function normalizeAlerts(alerts: Alerts): AlertConfig[] {
  return alerts.map(normalizeAlertEntry);
}
