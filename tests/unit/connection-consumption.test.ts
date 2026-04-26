import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-connection-consumption-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const coreDb = await import("../../src/lib/db/core.ts");
const usageHistory = await import("../../src/lib/usage/usageHistory.ts");
const consumption = await import("../../src/lib/usage/connectionConsumption.ts");

async function resetStorage() {
  coreDb.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  coreDb.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("getConnectionRollingConsumption returns daily and weekly token totals", async () => {
  const connectionId = "conn-consumption-1";
  const now = Date.now();

  await usageHistory.saveRequestUsage({
    provider: "codex",
    model: "gpt-5.3-codex",
    connectionId,
    tokens: { input: 100, output: 50, cacheRead: 10, cacheCreation: 5, reasoning: 2 },
    success: true,
    timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
  });

  await usageHistory.saveRequestUsage({
    provider: "codex",
    model: "gpt-5.3-codex",
    connectionId,
    tokens: { input: 20, output: 10, cacheRead: 0, cacheCreation: 0, reasoning: 0 },
    success: false,
    timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
  });

  await usageHistory.saveRequestUsage({
    provider: "codex",
    model: "gpt-5.3-codex",
    connectionId,
    tokens: { input: 200, output: 100, cacheRead: 0, cacheCreation: 0, reasoning: 0 },
    success: true,
    timestamp: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
  });

  await usageHistory.saveRequestUsage({
    provider: "codex",
    model: "gpt-5.3-codex",
    connectionId,
    tokens: { input: 300, output: 100, cacheRead: 0, cacheCreation: 0, reasoning: 0 },
    success: true,
    timestamp: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const summary = consumption.getConnectionRollingConsumption(connectionId);

  assert.equal(summary.daily.requestCount, 1);
  assert.equal(summary.daily.totalTokens, 167);

  assert.equal(summary.weekly.requestCount, 2);
  assert.equal(summary.weekly.totalTokens, 467);
});
