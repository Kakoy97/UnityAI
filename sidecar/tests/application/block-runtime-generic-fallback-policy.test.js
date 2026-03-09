"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createGenericPropertyFallbackPolicy,
  GenericPropertyFallbackMetricsCollector,
} = require("../../src/application/blockRuntime/execution");

function buildPolicyInput(overrides = {}) {
  return {
    mapping_meta: {
      family_key: "mutate.component_properties",
    },
    fallback_tool_name: "set_serialized_property",
    primary_attempted: true,
    block_spec: {
      input: {
        component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
        property_path: "m_Spacing",
      },
    },
    ...overrides,
  };
}

test("StepE policy allows fallback only when family and preconditions match", () => {
  const policy = createGenericPropertyFallbackPolicy({
    enabled: true,
    allowed_source_capability_families: ["Write.GenericProperty"],
    source_family_alias_map: {
      "mutate.component_properties": "Write.GenericProperty",
    },
    component_type_whitelist_patterns: [
      "^UnityEngine\\.[A-Za-z0-9_+.]+\\s*,\\s*[A-Za-z0-9_+.]+$",
    ],
    property_path_whitelist_patterns: ["^m_[A-Za-z0-9_.\\[\\]-]+$"],
  });

  const allowed = policy.evaluate(buildPolicyInput());
  assert.equal(allowed.ok, true);
  assert.equal(allowed.reason_code, "fallback_allowed");
  assert.equal(allowed.fallback_reason, "controlled_generic_property_fallback");

  const missingPrimaryAttempt = policy.evaluate(
    buildPolicyInput({
      primary_attempted: false,
    })
  );
  assert.equal(missingPrimaryAttempt.ok, false);
  assert.equal(missingPrimaryAttempt.error.error_code, "E_SCHEMA_INVALID");
});

test("StepE policy rejects fallback for non-whitelisted family with explicit block code", () => {
  const policy = createGenericPropertyFallbackPolicy({
    enabled: true,
    allowed_source_capability_families: [],
    source_family_alias_map: {
      "mutate.component_properties": "Write.GenericProperty",
    },
    component_type_whitelist_patterns: [
      "^UnityEngine\\.[A-Za-z0-9_+.]+\\s*,\\s*[A-Za-z0-9_+.]+$",
    ],
    property_path_whitelist_patterns: ["^m_[A-Za-z0-9_.\\[\\]-]+$"],
  });

  const denied = policy.evaluate(buildPolicyInput());
  assert.equal(denied.ok, false);
  assert.equal(denied.error.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.error.block_error_code, "E_BLOCK_FALLBACK_NOT_ALLOWED");
});

test("StepE fallback metrics collector computes totals and rates", () => {
  const collector = new GenericPropertyFallbackMetricsCollector();
  collector.recordDecision({
    event_type: "attempt",
    family_key: "mutate.component_properties",
    reason_code: "fallback_allowed",
  });
  collector.recordDecision({
    event_type: "used",
    family_key: "mutate.component_properties",
    reason_code: "fallback_allowed",
  });
  collector.recordDecision({
    event_type: "success",
    family_key: "mutate.component_properties",
    reason_code: "fallback_allowed",
  });

  const snapshot = collector.getSnapshot();
  assert.equal(snapshot.totals.attempt_total, 1);
  assert.equal(snapshot.totals.used_total, 1);
  assert.equal(snapshot.totals.success_total, 1);
  assert.equal(snapshot.rates.fallback_use_rate, 1);
  assert.equal(snapshot.rates.fallback_success_rate, 1);
});
