"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PLANNER_ENTRY_TRANSLATOR_VERSION,
  ENTRY_INTENT_KEY_SOURCE,
  createPlannerEntryTranslator,
} = require("../../src/application/blockRuntime/entry");

function buildReadBlockSpec(overrides = {}) {
  return {
    block_id: "block_entry_translator_read_1",
    block_type: "READ_STATE",
    input: {
      scope_path: "Scene/Canvas",
    },
    ...overrides,
  };
}

test("PLNR-003 planner entry translator exports stable version and intent key sources", () => {
  assert.equal(typeof PLANNER_ENTRY_TRANSLATOR_VERSION, "string");
  assert.ok(PLANNER_ENTRY_TRANSLATOR_VERSION.length > 0);
  assert.equal(ENTRY_INTENT_KEY_SOURCE.INTENT_KEY, "intent_key");
  assert.equal(ENTRY_INTENT_KEY_SOURCE.FAMILY_KEY, "family_key");
  assert.equal(
    ENTRY_INTENT_KEY_SOURCE.LEGACY_CONCRETE_KEY,
    "legacy_concrete_key"
  );
});

test("PLNR-003 translator resolves family_key to canonical intent_key and strips alias fields", () => {
  const translator = createPlannerEntryTranslator();
  const outcome = translator.translateBlockSpec(
    buildReadBlockSpec({
      family_key: "read.snapshot_for_write",
    })
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.translation_meta.intent_key_source, "family_key");
  assert.equal(outcome.block_spec.intent_key, "read.snapshot_for_write");
  assert.equal("family_key" in outcome.block_spec, false);
  assert.equal("legacy_concrete_key" in outcome.block_spec, false);
});

test("PLNR-003 translator resolves legacy_concrete_key to canonical intent_key", () => {
  const translator = createPlannerEntryTranslator();
  const outcome = translator.translateBlockSpec(
    buildReadBlockSpec({
      legacy_concrete_key: "get_scene_snapshot_for_write",
    })
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.translation_meta.intent_key_source, "legacy_concrete_key");
  assert.equal(outcome.block_spec.intent_key, "get_scene_snapshot_for_write");
});

test("PLNR-003 translator fails closed when family_key conflicts with legacy_concrete_key", () => {
  const translator = createPlannerEntryTranslator();
  const outcome = translator.translateBlockSpec(
    buildReadBlockSpec({
      family_key: "read.snapshot_for_write",
      legacy_concrete_key: "get_scene_snapshot_for_write",
    })
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_SCHEMA_INVALID");
  assert.equal(outcome.error_message, "family_key conflicts with legacy_concrete_key");
});

test("PLNR-003 translator fails closed when all intent aliases are missing", () => {
  const translator = createPlannerEntryTranslator();
  const outcome = translator.translateBlockSpec(buildReadBlockSpec());
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_SCHEMA_INVALID");
  assert.equal(
    outcome.error_message,
    "block_spec requires one of: intent_key, family_key, legacy_concrete_key"
  );
});
