export type Thresholds = readonly number[]; // e.g. [75, 100]

export const DEFAULT_THRESHOLDS: Thresholds = [75, 100] as const;

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

  /** Optional thresholds override.
   */
  thresholds?: Thresholds;
}

export interface BudgetConfig {
  default: {
    amount?: number;
    currency: string;
    thresholds?: Thresholds;
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
