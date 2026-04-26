type JsonRecord = Record<string, unknown>;

export interface CodexUsageWindow {
  usedPercent: number;
  remainingPercent: number;
  resetAt: string | null;
}

export interface CodexUsageWindowsSnapshot {
  session: CodexUsageWindow | null;
  weekly: CodexUsageWindow | null;
  codeReview: CodexUsageWindow | null;
  limitReached: boolean;
  plan: string;
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function getFieldValue(source: unknown, snakeKey: string, camelKey: string): unknown {
  const obj = toRecord(source);
  return obj[snakeKey] ?? obj[camelKey] ?? null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function parseWindowReset(window: unknown, nowMs = Date.now()): string | null {
  const resetAt = toNumber(getFieldValue(window, "reset_at", "resetAt"), 0);
  const resetAfterSeconds = toNumber(
    getFieldValue(window, "reset_after_seconds", "resetAfterSeconds"),
    0
  );

  if (resetAt > 0) return new Date(resetAt * 1000).toISOString();
  if (resetAfterSeconds > 0) return new Date(nowMs + resetAfterSeconds * 1000).toISOString();
  return null;
}

function parseUsageWindow(window: unknown, nowMs = Date.now()): CodexUsageWindow | null {
  const source = toRecord(window);
  if (Object.keys(source).length === 0) return null;

  const usedPercent = clampPercent(
    toNumber(getFieldValue(source, "used_percent", "usedPercent"), 0)
  );
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetAt: parseWindowReset(source, nowMs),
  };
}

/**
 * Parse ChatGPT/Codex usage windows from `backend-api/wham/usage`.
 * Supports both snake_case and camelCase payloads.
 */
export function parseCodexUsageWindows(
  data: unknown,
  nowMs = Date.now()
): CodexUsageWindowsSnapshot | null {
  const root = toRecord(data);
  const rateLimit = toRecord(getFieldValue(root, "rate_limit", "rateLimit"));
  const primaryWindow = toRecord(getFieldValue(rateLimit, "primary_window", "primaryWindow"));
  const secondaryWindow = toRecord(getFieldValue(rateLimit, "secondary_window", "secondaryWindow"));
  const codeReviewRateLimit = toRecord(
    getFieldValue(root, "code_review_rate_limit", "codeReviewRateLimit")
  );
  const codeReviewWindow = toRecord(
    getFieldValue(codeReviewRateLimit, "primary_window", "primaryWindow")
  );

  const session = parseUsageWindow(primaryWindow, nowMs);
  const weekly = parseUsageWindow(secondaryWindow, nowMs);

  const codeReviewHasData =
    getFieldValue(codeReviewWindow, "used_percent", "usedPercent") !== null ||
    getFieldValue(codeReviewWindow, "remaining_count", "remainingCount") !== null;
  const codeReview = codeReviewHasData ? parseUsageWindow(codeReviewWindow, nowMs) : null;

  if (!session && !weekly && !codeReview) return null;

  return {
    session,
    weekly,
    codeReview,
    limitReached: Boolean(getFieldValue(rateLimit, "limit_reached", "limitReached")),
    plan: String(getFieldValue(root, "plan_type", "planType") || "unknown"),
  };
}
