"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWriteContractBundleView,
} = require("../../src/application/ssotRuntime/contractAdvisor");
const {
  ContractBundleCache,
  buildContractBundleCacheKey,
  getContractBundleCacheMetricsForTests,
  resetContractBundleCacheSingletonForTests,
} = require("../../src/application/ssotRuntime/contractBundleCache");

test("build write contract bundle uses cache on repeated request", () => {
  resetContractBundleCacheSingletonForTests();

  const payload = {
    tool_name: "modify_ui_layout",
    include_enhanced: true,
    include_legacy: false,
    include_related: true,
    budget_chars: 12000,
    context: {
      scenario: "batch_ui_create",
      previous_tool: "get_scene_snapshot_for_write",
    },
  };

  const first = buildWriteContractBundleView(payload);
  const second = buildWriteContractBundleView(payload);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.body?.metadata?.cache_hit, false);
  assert.equal(second.body?.metadata?.cache_hit, true);

  const metrics = getContractBundleCacheMetricsForTests();
  assert.equal(metrics.misses >= 1, true);
  assert.equal(metrics.hits >= 1, true);
  assert.equal(metrics.sets >= 1, true);
});

test("contract bundle cache key changes when scenario context changes", () => {
  const keyA = buildContractBundleCacheKey({
    catalogVersion: "v1",
    toolName: "execute_unity_transaction",
    actionType: "",
    budgetChars: 12000,
    includeErrorFixMap: true,
    includeCanonicalExamples: true,
    includeRelated: true,
    includeEnhanced: true,
    includeLegacy: false,
    scenario: "batch_ui_create",
    previousTool: "get_scene_snapshot_for_write",
  });
  const keyB = buildContractBundleCacheKey({
    catalogVersion: "v1",
    toolName: "execute_unity_transaction",
    actionType: "",
    budgetChars: 12000,
    includeErrorFixMap: true,
    includeCanonicalExamples: true,
    includeRelated: true,
    includeEnhanced: true,
    includeLegacy: false,
    scenario: "single_object_modify",
    previousTool: "get_scene_snapshot_for_write",
  });
  assert.notEqual(keyA, keyB);
});

test("contract bundle cache evicts oldest entry when max size reached", () => {
  const cache = new ContractBundleCache({ maxEntries: 1 });
  cache.set("a", { body: { ok: true } });
  cache.set("b", { body: { ok: true } });

  const miss = cache.get("a");
  const hit = cache.get("b");
  const metrics = cache.snapshot();

  assert.equal(miss, null);
  assert.deepEqual(hit, { body: { ok: true } });
  assert.equal(metrics.evictions, 1);
});
