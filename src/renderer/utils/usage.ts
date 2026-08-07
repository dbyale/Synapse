export const INPUT_PRICE_PER_MILLION = 10.0;
export const OUTPUT_PRICE_PER_MILLION = 50.0;
export const WEB_SEARCH_PRICE = 0.1;

export interface MonthlyUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalWebSearches: number;
}

export interface UsageStore {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalWebSearches: number;
  lastAutoOpenedMonthId: string | null;
  monthly: Record<string, MonthlyUsage>;
}

export type UsageSummary = UsageStore;

export const EMPTY_MONTHLY_USAGE: MonthlyUsage = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalWebSearches: 0,
};

export const EMPTY_USAGE: UsageStore = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalWebSearches: 0,
  lastAutoOpenedMonthId: null,
  monthly: {},
};

export function getMonthId(date: Date = new Date()): string {
  return `${date.getMonth() + 1}-${date.getFullYear()}`;
}

export function calcSavings(
  inputTokens: number,
  outputTokens: number,
  webSearches: number,
): number {
  return (
    (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION +
    (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION +
    webSearches * WEB_SEARCH_PRICE
  );
}

export function totalSavings(usage: UsageStore): number {
  return calcSavings(
    usage.totalInputTokens,
    usage.totalOutputTokens,
    usage.totalWebSearches,
  );
}

export function monthlySavings(usage: UsageStore, monthId: string): number {
  const monthly = usage.monthly[monthId] ?? EMPTY_MONTHLY_USAGE;
  return calcSavings(
    monthly.totalInputTokens,
    monthly.totalOutputTokens,
    monthly.totalWebSearches,
  );
}

export function formatNumber(n: number): string {
  return (n || 0).toLocaleString('en-US');
}

export function formatMoney(n: number): string {
  return `$${(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getNonZeroMonthly(month: MonthlyUsage): boolean {
  return (
    month.totalInputTokens > 0 ||
    month.totalOutputTokens > 0 ||
    month.totalWebSearches > 0
  );
}

export function getLastNonZeroMonthId(usage: UsageStore): string | null {
  const key = Object.keys(usage.monthly)
    .reverse()
    .find((monthId) => getNonZeroMonthly(usage.monthly[monthId]));
  return key ?? null;
}
