/**
 * quotaPreflight.ts — Feature 04
 * Quota Preflight & Troca Proativa de Conta
 *
 * Toggle: providerSpecificData.quotaPreflightEnabled (default: false)
 * Providers register quota fetchers via registerQuotaFetcher().
 * Graceful degradation when no fetcher registered.
 */

export interface PreflightQuotaResult {
  proceed: boolean;
  reason?: string;
  quotaPercent?: number;
  resetAt?: string | null;
}

export interface QuotaInfo {
  used: number;
  total: number;
  percentUsed: number;
  resetAt?: string | null;
}

interface CodexDualWindowQuotaInfo extends QuotaInfo {
  window5h?: { percentUsed: number; resetAt: string | null };
  window7d?: { percentUsed: number; resetAt: string | null };
}

export type QuotaFetcher = (
  connectionId: string,
  connection?: Record<string, unknown>
) => Promise<QuotaInfo | null>;

const DEFAULT_EXHAUSTION_THRESHOLD_PERCENT = 95;
const CODEX_DEFAULT_EXHAUSTION_THRESHOLD_PERCENT = 90;
const WARN_THRESHOLD = 0.8;

const quotaFetcherRegistry = new Map<string, QuotaFetcher>();

export function registerQuotaFetcher(provider: string, fetcher: QuotaFetcher): void {
  quotaFetcherRegistry.set(provider, fetcher);
}

export function isQuotaPreflightEnabled(connection: Record<string, unknown>): boolean {
  const psd = connection?.providerSpecificData as Record<string, unknown> | undefined;
  return psd?.quotaPreflightEnabled === true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function clampThresholdPercent(value: unknown, fallback: number): number {
  const parsed = toNumber(value, fallback);
  return Math.max(1, Math.min(100, parsed));
}

function normalizeCodexWindowName(windowName: unknown): string | null {
  if (typeof windowName !== "string") return null;
  const normalized = windowName.trim().toLowerCase();
  if (
    normalized === "session" ||
    normalized === "session (5h)" ||
    normalized === "5h" ||
    normalized === "daily" ||
    normalized === "24h" ||
    normalized === "daily (24h)"
  ) {
    return "session";
  }
  if (normalized === "weekly" || normalized === "weekly (7d)" || normalized === "7d") {
    return "weekly";
  }
  return normalized || null;
}

function isCodexDualWindowQuota(quota: QuotaInfo): quota is CodexDualWindowQuotaInfo {
  const maybeQuota = quota as CodexDualWindowQuotaInfo;
  return Boolean(maybeQuota.window5h || maybeQuota.window7d);
}

function getEnabledCodexWindows(connection: Record<string, unknown>): {
  use5h: boolean;
  useWeekly: boolean;
} {
  const psd = asRecord(connection?.providerSpecificData);
  const codexPolicy = asRecord(psd.codexLimitPolicy);
  return {
    use5h: typeof codexPolicy.use5h === "boolean" ? codexPolicy.use5h : true,
    useWeekly: typeof codexPolicy.useWeekly === "boolean" ? codexPolicy.useWeekly : true,
  };
}

function getPolicyThresholdPercent(provider: string, connection: Record<string, unknown>): number {
  const psd = asRecord(connection?.providerSpecificData);
  const policy = asRecord(psd.limitPolicy);
  const fallback =
    provider === "codex"
      ? CODEX_DEFAULT_EXHAUSTION_THRESHOLD_PERCENT
      : DEFAULT_EXHAUSTION_THRESHOLD_PERCENT;
  return clampThresholdPercent(policy.thresholdPercent, fallback);
}

function getWindowThresholdPercent(
  connection: Record<string, unknown>,
  provider: string,
  windowName: string,
  fallback: number
): number {
  const psd = asRecord(connection?.providerSpecificData);
  const policy = asRecord(psd.limitPolicy);
  const windowThresholds = asRecord(policy.windowThresholds);
  const normalizedWindow =
    provider === "codex" ? normalizeCodexWindowName(windowName) || windowName : windowName;
  return clampThresholdPercent(windowThresholds[normalizedWindow], fallback);
}

function getEarliestReset(candidates: Array<string | null>): string | null {
  const now = Date.now();
  let earliest: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!candidate) continue;
    const ms = new Date(candidate).getTime();
    if (!Number.isFinite(ms) || ms <= now) continue;
    if (ms < earliestMs) {
      earliestMs = ms;
      earliest = candidate;
    }
  }

  return earliest;
}

export async function preflightQuota(
  provider: string,
  connectionId: string,
  connection: Record<string, unknown>
): Promise<PreflightQuotaResult> {
  if (!isQuotaPreflightEnabled(connection)) {
    return { proceed: true };
  }

  const fetcher = quotaFetcherRegistry.get(provider);
  if (!fetcher) {
    return { proceed: true };
  }

  let quota: QuotaInfo | null = null;
  try {
    quota = await fetcher(connectionId, connection);
  } catch {
    return { proceed: true };
  }

  if (!quota) {
    return { proceed: true };
  }

  const { percentUsed } = quota;

  if (provider === "codex" && isCodexDualWindowQuota(quota)) {
    const globalThresholdPercent = getPolicyThresholdPercent(provider, connection);
    const enabledWindows = getEnabledCodexWindows(connection);
    const evaluatedWindows: Array<{
      window: "session" | "weekly";
      percentUsed: number;
      thresholdPercent: number;
      resetAt: string | null;
    }> = [];

    if (enabledWindows.use5h && quota.window5h) {
      evaluatedWindows.push({
        window: "session",
        percentUsed: quota.window5h.percentUsed,
        thresholdPercent: getWindowThresholdPercent(
          connection,
          provider,
          "session",
          globalThresholdPercent
        ),
        resetAt: quota.window5h.resetAt ?? null,
      });
    }

    if (enabledWindows.useWeekly && quota.window7d) {
      evaluatedWindows.push({
        window: "weekly",
        percentUsed: quota.window7d.percentUsed,
        thresholdPercent: getWindowThresholdPercent(
          connection,
          provider,
          "weekly",
          globalThresholdPercent
        ),
        resetAt: quota.window7d.resetAt ?? null,
      });
    }

    if (evaluatedWindows.length > 0) {
      const exhaustedWindows = evaluatedWindows.filter(
        (window) => window.percentUsed * 100 >= window.thresholdPercent
      );

      if (exhaustedWindows.length > 0) {
        const strongestWindow = exhaustedWindows.sort((a, b) => b.percentUsed - a.percentUsed)[0];
        const quotaPercent = Math.max(...exhaustedWindows.map((window) => window.percentUsed));
        const resetAt = getEarliestReset(exhaustedWindows.map((window) => window.resetAt));

        console.info(
          `[QuotaPreflight] ${provider}/${connectionId}: ${(quotaPercent * 100).toFixed(1)}% used on ${strongestWindow.window} window (threshold=${strongestWindow.thresholdPercent}%) — switching`
        );

        return {
          proceed: false,
          reason: "quota_exhausted",
          quotaPercent,
          resetAt,
        };
      }

      const evaluatedPercentUsed = Math.max(...evaluatedWindows.map((window) => window.percentUsed));
      if (evaluatedPercentUsed >= WARN_THRESHOLD) {
        console.warn(
          `[QuotaPreflight] ${provider}/${connectionId}: ${(evaluatedPercentUsed * 100).toFixed(1)}% used — approaching limit`
        );
      }

      return {
        proceed: true,
        quotaPercent: evaluatedPercentUsed,
      };
    }
  }

  const thresholdPercent = getPolicyThresholdPercent(provider, connection);
  const threshold = thresholdPercent / 100;

  if (percentUsed >= threshold) {
    console.info(
      `[QuotaPreflight] ${provider}/${connectionId}: ${(percentUsed * 100).toFixed(1)}% used (threshold=${thresholdPercent}%) — switching`
    );
    return {
      proceed: false,
      reason: "quota_exhausted",
      quotaPercent: percentUsed,
      resetAt: quota.resetAt ?? null,
    };
  }

  if (percentUsed >= WARN_THRESHOLD) {
    console.warn(
      `[QuotaPreflight] ${provider}/${connectionId}: ${(percentUsed * 100).toFixed(1)}% used — approaching limit`
    );
  }

  return { proceed: true, quotaPercent: percentUsed };
}
