"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  UnityTestRunnerService,
} = require("../../src/application/unityTestRunnerService");
const {
  SSOT_QUERY_TYPES,
} = require("../../src/application/ssotRuntime/queryTypes");

test("UnityTestRunnerService dispatches unity.test.run query and returns normalized data", async () => {
  const calls = [];
  const service = new UnityTestRunnerService({
    enqueueAndWaitForUnityQuery: async (input) => {
      calls.push(input);
      return {
        ok: true,
        tool_name: "run_unity_tests",
        run_id: "run_001",
        scope_requested: "all",
        scope_executed: ["editmode", "playmode"],
        status: "failed",
        total: 6,
        passed: 5,
        failed: 1,
        skipped: 0,
        inconclusive: 0,
        duration_ms: 3210,
        platform_results: [
          {
            platform: "editmode",
            status: "succeeded",
            total: 3,
            passed: 3,
            failed: 0,
            skipped: 0,
            inconclusive: 0,
            duration_ms: 1000,
            failed_cases: [],
          },
          {
            platform: "playmode",
            status: "failed",
            total: 3,
            passed: 2,
            failed: 1,
            skipped: 0,
            inconclusive: 0,
            duration_ms: 2210,
            failed_cases: [
              {
                platform: "playmode",
                name: "PlayModeFail",
                fullname: "Suite.PlayModeFail",
                message: "boom",
                stack_trace: "stack",
              },
            ],
          },
        ],
        failed_cases: [
          {
            platform: "playmode",
            name: "PlayModeFail",
            fullname: "Suite.PlayModeFail",
            message: "boom",
            stack_trace: "stack",
          },
        ],
      };
    },
  });

  const result = await service.runUnityTests({
    scope: "all",
    timeout_seconds: 120,
    test_filter: "Suite.",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].queryType, SSOT_QUERY_TYPES.UNITY_TEST_RUN);
  assert.equal(calls[0].timeoutMs, 120000);
  assert.equal(calls[0].payload.scope, "all");
  assert.equal(calls[0].payload.test_filter, "Suite.");

  assert.equal(result.tool_name, "run_unity_tests");
  assert.equal(result.run_id, "run_001");
  assert.equal(result.status, "failed");
  assert.equal(result.total, 6);
  assert.equal(result.failed_cases.length, 1);
});

test("UnityTestRunnerService maps query timeout to E_UNITY_TEST_TIMEOUT", async () => {
  const service = new UnityTestRunnerService({
    enqueueAndWaitForUnityQuery: async () => {
      const error = new Error("query timeout");
      error.error_code = "E_QUERY_TIMEOUT";
      throw error;
    },
  });

  await assert.rejects(
    () => service.runUnityTests({ scope: "editmode", timeout_seconds: 45 }),
    (error) => {
      assert.equal(error && error.errorCode, "E_UNITY_TEST_TIMEOUT");
      assert.equal(error && error.statusCode, 504);
      return true;
    }
  );
});

test("UnityTestRunnerService maps unsupported query type to E_UNITY_TEST_QUERY_UNAVAILABLE", async () => {
  const service = new UnityTestRunnerService({
    enqueueAndWaitForUnityQuery: async () => {
      const error = new Error("unsupported query type");
      error.error_code = "E_UNSUPPORTED_QUERY_TYPE";
      throw error;
    },
  });

  await assert.rejects(
    () => service.runUnityTests({ scope: "editmode", timeout_seconds: 60 }),
    (error) => {
      assert.equal(error && error.errorCode, "E_UNITY_TEST_QUERY_UNAVAILABLE");
      assert.equal(error && error.statusCode, 502);
      return true;
    }
  );
});
