import * as fs from 'fs';
import { app } from 'electron';
import path from 'path';
import type { UsageStore, MonthlyUsage } from '../renderer/utils/usage';
import {
  getMonthId,
  EMPTY_USAGE,
  EMPTY_MONTHLY_USAGE,
} from '../renderer/utils/usage';

function getUsagePath(): string {
  return path.join(app.getPath('userData'), 'tokenUsage.json');
}

function normalize(store: any): UsageStore {
  const base = { ...EMPTY_USAGE };
  if (!store || typeof store !== 'object') return base;
  base.totalInputTokens = Number(store.totalInputTokens) || 0;
  base.totalOutputTokens = Number(store.totalOutputTokens) || 0;
  base.totalWebSearches = Number(store.totalWebSearches) || 0;
  base.lastAutoOpenedMonthId =
    typeof store.lastAutoOpenedMonthId === 'string'
      ? store.lastAutoOpenedMonthId
      : null;
  if (store.monthly && typeof store.monthly === 'object') {
    base.monthly = {};
    Object.keys(store.monthly).forEach((key) => {
      const m = store.monthly[key];
      base.monthly[key] = {
        totalInputTokens: Number(m?.totalInputTokens) || 0,
        totalOutputTokens: Number(m?.totalOutputTokens) || 0,
        totalWebSearches: Number(m?.totalWebSearches) || 0,
      };
    });
  }
  return base;
}

function loadUsage(): UsageStore {
  try {
    return normalize(JSON.parse(fs.readFileSync(getUsagePath(), 'utf-8')));
  } catch {
    return { ...EMPTY_USAGE };
  }
}

function saveUsage(store: UsageStore): void {
  try {
    fs.writeFileSync(getUsagePath(), JSON.stringify(store), 'utf-8');
  } catch (e) {
    console.error('[usage] Failed to save token usage:', e);
  }
}

function bumpMonthly(
  monthly: Record<string, MonthlyUsage>,
  monthId: string,
  mutate: (month: MonthlyUsage) => void,
): void {
  const current = monthly[monthId] ?? { ...EMPTY_MONTHLY_USAGE };
  mutate(current);
  monthly[monthId] = current;
}

export function addTokenUsage(inputTokens: number, outputTokens: number): void {
  const store = loadUsage();
  store.totalInputTokens += inputTokens;
  store.totalOutputTokens += outputTokens;
  bumpMonthly(store.monthly, getMonthId(), (month) => {
    month.totalInputTokens += inputTokens;
    month.totalOutputTokens += outputTokens;
  });
  saveUsage(store);
}

export function addWebSearch(): void {
  const store = loadUsage();
  store.totalWebSearches += 1;
  bumpMonthly(store.monthly, getMonthId(), (month) => {
    month.totalWebSearches += 1;
  });
  saveUsage(store);
}

export function getUsage(): UsageStore {
  return loadUsage();
}

export function setLastAutoOpenedMonth(monthId: string | null): void {
  const store = loadUsage();
  store.lastAutoOpenedMonthId = monthId;
  saveUsage(store);
}
