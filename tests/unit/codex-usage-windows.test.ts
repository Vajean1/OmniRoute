import test from "node:test";
import assert from "node:assert/strict";

import { parseCodexUsageWindows } from "../../open-sse/services/codexUsageWindows.ts";

test("parseCodexUsageWindows parses primary and secondary windows", () => {
  const now = Date.now();
  const parsed = parseCodexUsageWindows(
    {
      rate_limit: {
        primary_window: {
          used_percent: 72,
          reset_after_seconds: 120,
        },
        secondary_window: {
          used_percent: 35,
          reset_at: Math.floor((now + 600_000) / 1000),
        },
      },
      plan_type: "pro",
    },
    now
  );

  assert.ok(parsed);
  assert.equal(parsed?.plan, "pro");
  assert.equal(parsed?.session?.usedPercent, 72);
  assert.equal(parsed?.session?.remainingPercent, 28);
  assert.equal(parsed?.weekly?.usedPercent, 35);
  assert.equal(parsed?.limitReached, false);
});

test("parseCodexUsageWindows supports camelCase and codeReview window", () => {
  const now = Date.now();
  const parsed = parseCodexUsageWindows(
    {
      rateLimit: {
        primaryWindow: {
          usedPercent: 10,
          resetAfterSeconds: 30,
        },
      },
      codeReviewRateLimit: {
        primaryWindow: {
          usedPercent: 40,
          resetAfterSeconds: 180,
          remainingCount: 3,
        },
      },
      planType: "plus",
    },
    now
  );

  assert.ok(parsed);
  assert.equal(parsed?.plan, "plus");
  assert.equal(parsed?.session?.usedPercent, 10);
  assert.equal(parsed?.weekly, null);
  assert.equal(parsed?.codeReview?.usedPercent, 40);
});

test("parseCodexUsageWindows returns null when no quota windows exist", () => {
  const parsed = parseCodexUsageWindows({ plan_type: "free" });
  assert.equal(parsed, null);
});
