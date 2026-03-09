"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FALLBACK_POLICY_GUARD_VERSION,
  GENERIC_FALLBACK_STRICT_ENV_KEY,
  evaluateFallbackPolicyGuard,
  resolveGenericFallbackStrictEnabled,
} = require("../../src/application/blockRuntime/execution");

test("PLNR-008 fallback policy guard exports stable symbols", () => {
  assert.equal(typeof FALLBACK_POLICY_GUARD_VERSION, "string");
  assert.equal(FALLBACK_POLICY_GUARD_VERSION.length > 0, true);
  assert.equal(
    GENERIC_FALLBACK_STRICT_ENV_KEY,
    "MCP_GENERIC_FALLBACK_STRICT"
  );
});

test("PLNR-008 strict switch defaults to enabled and can be disabled by env", () => {
  const envKey = GENERIC_FALLBACK_STRICT_ENV_KEY;
  const previous = process.env[envKey];
  try {
    delete process.env[envKey];
    assert.equal(resolveGenericFallbackStrictEnabled({}), true);
    process.env[envKey] = "false";
    assert.equal(resolveGenericFallbackStrictEnabled({}), false);
  } finally {
    if (previous === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previous;
    }
  }
});

test("PLNR-008 strict guard rejects cross-family generic fallback candidate", () => {
  const decision = evaluateFallbackPolicyGuard(
    {
      family_key: "write.hierarchy.parent",
      fallback_policy: {
        mode: "controlled",
        trigger: "specialized_failed",
        tools: ["set_serialized_property"],
      },
    },
    {
      generic_fallback_strict: true,
    }
  );
  assert.equal(decision.ok, false);
  assert.equal(decision.error.error_code, "E_PRECONDITION_FAILED");
  assert.equal(decision.error.block_error_code, "E_BLOCK_FALLBACK_NOT_ALLOWED");
});

test("PLNR-008 strict guard allows Write.GenericProperty fallback family", () => {
  const decision = evaluateFallbackPolicyGuard(
    {
      family_key: "mutate.component_properties",
      fallback_policy: {
        mode: "controlled",
        trigger: "specialized_failed",
        tools: ["set_serialized_property"],
      },
    },
    {
      generic_fallback_strict: true,
    }
  );
  assert.equal(decision.ok, true);
  assert.equal(decision.fallback_policy.mode, "controlled");
  assert.deepEqual(decision.fallback_policy.tools, ["set_serialized_property"]);
  assert.equal(decision.source_capability_family, "Write.GenericProperty");
});

test("PLNR-008 strict-disabled mode keeps fallback policy unchanged", () => {
  const decision = evaluateFallbackPolicyGuard(
    {
      family_key: "write.hierarchy.parent",
      fallback_policy: {
        mode: "controlled",
        trigger: "specialized_failed",
        tools: ["set_serialized_property"],
      },
    },
    {
      generic_fallback_strict: false,
    }
  );
  assert.equal(decision.ok, true);
  assert.equal(decision.guard_state, "strict_disabled");
  assert.equal(decision.fallback_policy.mode, "controlled");
  assert.deepEqual(decision.fallback_policy.tools, ["set_serialized_property"]);
});
