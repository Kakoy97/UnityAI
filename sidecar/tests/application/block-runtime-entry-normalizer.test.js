"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPlannerEntryNormalizer,
} = require("../../src/application/blockRuntime/entry");

function buildUxContract() {
  return {
    domain: "planner_entry",
    block_type_enum: ["READ_STATE", "CREATE", "MUTATE", "VERIFY"],
    required_business_fields: [
      "block_spec.block_id",
      "block_spec.block_type",
      "block_spec.intent_key",
      "block_spec.input",
    ],
    system_fields: [
      "thread_id",
      "execution_context",
      "plan_initial_read_token",
      "previous_read_token_candidate",
      "transaction_read_token_candidate",
      "block_spec.based_on_read_token",
    ],
    auto_filled_fields: [
      "block_spec.write_envelope.execution_mode",
      "block_spec.write_envelope.idempotency_key",
      "block_spec.write_envelope.write_anchor_object_id",
      "block_spec.write_envelope.write_anchor_path",
    ],
    minimal_valid_template: {
      block_spec: {
        block_id: "block_read_snapshot_1",
        block_type: "READ_STATE",
        intent_key: "read.snapshot_for_write",
        input: {
          scope_path: "Scene/Canvas",
        },
      },
    },
    common_aliases: {
      "block_spec.block_type": ["block_spec.type", "block_spec.blockType"],
      "block_spec.intent_key": ["block_spec.intent"],
      "block_spec.target_anchor.object_id": ["block_spec.target_object_id"],
      "block_spec.target_anchor.path": ["block_spec.target_path"],
      "block_spec.write_envelope.execution_mode": ["block_spec.write_envelope.mode"],
      "block_spec.write_envelope.idempotency_key": [
        "block_spec.write_envelope.idempotency",
      ],
    },
    autofill_policy: {
      write_envelope_execution_mode: {
        field: "block_spec.write_envelope.execution_mode",
        strategy: "default_if_missing",
        value: "execute",
        conditions: {
          block_type_in: ["CREATE", "MUTATE"],
        },
      },
      write_envelope_idempotency_key: {
        field: "block_spec.write_envelope.idempotency_key",
        strategy: "generate_if_missing",
        conditions: {
          block_type_in: ["CREATE", "MUTATE"],
        },
      },
      write_anchor_object_id_from_target_anchor: {
        field: "block_spec.write_envelope.write_anchor_object_id",
        strategy: "copy_if_missing",
        source_field: "block_spec.target_anchor.object_id",
        conditions: {
          block_type_in: ["CREATE", "MUTATE"],
        },
      },
      write_anchor_path_from_target_anchor: {
        field: "block_spec.write_envelope.write_anchor_path",
        strategy: "copy_if_missing",
        source_field: "block_spec.target_anchor.path",
        conditions: {
          block_type_in: ["CREATE", "MUTATE"],
        },
      },
    },
  };
}

test("Step5 normalizer rewrites known aliases into canonical planner fields", () => {
  const normalizer = createPlannerEntryNormalizer({
    uxContract: buildUxContract(),
  });
  const outcome = normalizer.normalizePayload({
    block_spec: {
      block_id: "block_alias_1",
      type: "MUTATE",
      intent: "mutate.set_active",
      input: {
        active: true,
      },
      target_object_id: "GlobalObjectId_V1-target",
      target_path: "Scene/Canvas/Image",
      based_on_read_token: "ssot_rt_alias_1",
      write_envelope: {
        mode: "execute",
      },
    },
  });

  assert.equal(outcome.ok, true);
  const blockSpec = outcome.payload.block_spec;
  assert.equal(blockSpec.block_type, "MUTATE");
  assert.equal(blockSpec.intent_key, "mutate.set_active");
  assert.equal(blockSpec.target_anchor.object_id, "GlobalObjectId_V1-target");
  assert.equal(blockSpec.target_anchor.path, "Scene/Canvas/Image");
  assert.equal(blockSpec.write_envelope.execution_mode, "execute");
  assert.equal(Object.prototype.hasOwnProperty.call(blockSpec, "type"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(blockSpec, "intent"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(blockSpec, "target_object_id"),
    false
  );
  assert.equal(Object.prototype.hasOwnProperty.call(blockSpec, "target_path"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(blockSpec.write_envelope, "mode"),
    false
  );
  assert.equal(outcome.normalization_meta.alias_hits.length > 0, true);
});

test("Step5 normalizer applies lossless autofill for high-frequency write envelope fields", () => {
  const normalizer = createPlannerEntryNormalizer({
    uxContract: buildUxContract(),
  });
  const outcome = normalizer.normalizePayload({
    block_spec: {
      block_id: "block_autofill_1",
      block_type: "MUTATE",
      intent_key: "mutate.set_active",
      input: {
        active: false,
      },
      target_anchor: {
        object_id: "GlobalObjectId_V1-target",
        path: "Scene/Canvas/Image",
      },
      based_on_read_token: "ssot_rt_autofill_1",
      write_envelope: {},
    },
  });

  assert.equal(outcome.ok, true);
  const blockSpec = outcome.payload.block_spec;
  assert.equal(blockSpec.write_envelope.execution_mode, "execute");
  assert.equal(typeof blockSpec.write_envelope.idempotency_key, "string");
  assert.equal(blockSpec.write_envelope.idempotency_key.length >= 8, true);
  assert.equal(
    blockSpec.write_envelope.write_anchor_object_id,
    "GlobalObjectId_V1-target"
  );
  assert.equal(blockSpec.write_envelope.write_anchor_path, "Scene/Canvas/Image");
  const autoFilledFields = outcome.normalization_meta.auto_filled_fields.map(
    (item) => item.field
  );
  assert.equal(
    autoFilledFields.includes("block_spec.write_envelope.execution_mode"),
    true
  );
  assert.equal(
    autoFilledFields.includes("block_spec.write_envelope.idempotency_key"),
    true
  );
  assert.equal(
    autoFilledFields.includes("block_spec.write_envelope.write_anchor_object_id"),
    true
  );
  assert.equal(
    autoFilledFields.includes("block_spec.write_envelope.write_anchor_path"),
    true
  );
  assert.equal(
    autoFilledFields.includes("block_spec.based_on_read_token"),
    false
  );
});

test("Step5 normalizer does not autofill based_on_read_token in phase1", () => {
  const normalizer = createPlannerEntryNormalizer({
    uxContract: buildUxContract(),
  });
  const outcome = normalizer.normalizePayload({
    block_spec: {
      block_id: "block_no_token_autofill_1",
      block_type: "MUTATE",
      intent_key: "mutate.set_active",
      input: {
        active: true,
      },
      target_anchor: {
        object_id: "GlobalObjectId_V1-target",
        path: "Scene/Canvas/Image",
      },
      write_envelope: {},
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      outcome.payload.block_spec,
      "based_on_read_token"
    ),
    false
  );
  assert.equal(
    outcome.normalization_meta.auto_filled_fields.some(
      (item) => item.field === "block_spec.based_on_read_token"
    ),
    false
  );
});

test("Step5 normalizer fails closed when alias conflicts with canonical field", () => {
  const normalizer = createPlannerEntryNormalizer({
    uxContract: buildUxContract(),
  });
  const outcome = normalizer.normalizePayload({
    block_spec: {
      block_id: "block_alias_conflict_1",
      block_type: "READ_STATE",
      type: "MUTATE",
      intent_key: "read.snapshot_for_write",
      input: {
        scope_path: "Scene/Canvas",
      },
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_SCHEMA_INVALID");
  assert.equal(
    outcome.error_message,
    "alias conflicts with canonical field: block_spec.type -> block_spec.block_type"
  );
});

