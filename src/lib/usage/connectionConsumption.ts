import { getDbInstance } from "@/lib/db/core";

export interface WindowConsumption {
  windowHours: number;
  since: string;
  until: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

interface RawWindowConsumptionRow {
  requestCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  reasoningTokens: number | null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getWindowConsumption(connectionId: string, windowHours: number): WindowConsumption {
  const now = new Date();
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const db = getDbInstance();

  const row = db
    .prepare(
      `
      SELECT
        COUNT(*) AS requestCount,
        COALESCE(SUM(tokens_input), 0) AS inputTokens,
        COALESCE(SUM(tokens_output), 0) AS outputTokens,
        COALESCE(SUM(tokens_cache_read), 0) AS cacheReadTokens,
        COALESCE(SUM(tokens_cache_creation), 0) AS cacheCreationTokens,
        COALESCE(SUM(tokens_reasoning), 0) AS reasoningTokens
      FROM usage_history
      WHERE connection_id = ?
        AND success = 1
        AND timestamp >= ?
      `
    )
    .get(connectionId, since.toISOString()) as RawWindowConsumptionRow;

  const inputTokens = toNumber(row?.inputTokens);
  const outputTokens = toNumber(row?.outputTokens);
  const cacheReadTokens = toNumber(row?.cacheReadTokens);
  const cacheCreationTokens = toNumber(row?.cacheCreationTokens);
  const reasoningTokens = toNumber(row?.reasoningTokens);

  return {
    windowHours,
    since: since.toISOString(),
    until: now.toISOString(),
    requestCount: toNumber(row?.requestCount),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    reasoningTokens,
    totalTokens:
      inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens + reasoningTokens,
  };
}

/**
 * Rolling per-connection consumption summaries used by Provider Limits APIs.
 */
export interface ConnectionRollingConsumption {
  daily: WindowConsumption;
  weekly: WindowConsumption;
}

export function getConnectionRollingConsumption(
  connectionId: string
): ConnectionRollingConsumption {
  return {
    daily: getWindowConsumption(connectionId, 24),
    weekly: getWindowConsumption(connectionId, 7 * 24),
  };
}
