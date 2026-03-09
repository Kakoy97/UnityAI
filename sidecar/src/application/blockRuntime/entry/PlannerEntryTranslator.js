"use strict";

const PLANNER_ENTRY_TRANSLATOR_VERSION = "phase1_step1_plnr003_v1";

const ENTRY_INTENT_KEY_SOURCE = Object.freeze({
  INTENT_KEY: "intent_key",
  FAMILY_KEY: "family_key",
  LEGACY_CONCRETE_KEY: "legacy_concrete_key",
});

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function buildSchemaError(errorMessage, details = {}) {
  return {
    ok: false,
    error_code: "E_SCHEMA_INVALID",
    error_message: normalizeString(errorMessage) || "planner entry translation failed",
    details: normalizeObject(details),
  };
}

function resolveIntentKey(sourceBlockSpec) {
  const blockSpec = normalizeObject(sourceBlockSpec);
  const intentKey = normalizeString(blockSpec.intent_key);
  const familyKey = normalizeString(blockSpec.family_key);
  const legacyConcreteKey = normalizeString(blockSpec.legacy_concrete_key);

  if (intentKey) {
    if (familyKey && familyKey !== intentKey) {
      return buildSchemaError(
        "intent_key conflicts with family_key",
        {
          intent_key: intentKey,
          family_key: familyKey,
        }
      );
    }
    if (legacyConcreteKey && legacyConcreteKey !== intentKey) {
      return buildSchemaError(
        "intent_key conflicts with legacy_concrete_key",
        {
          intent_key: intentKey,
          legacy_concrete_key: legacyConcreteKey,
        }
      );
    }
    return {
      ok: true,
      intent_key: intentKey,
      source: ENTRY_INTENT_KEY_SOURCE.INTENT_KEY,
    };
  }

  if (familyKey && legacyConcreteKey && familyKey !== legacyConcreteKey) {
    return buildSchemaError(
      "family_key conflicts with legacy_concrete_key",
      {
        family_key: familyKey,
        legacy_concrete_key: legacyConcreteKey,
      }
    );
  }

  if (familyKey) {
    return {
      ok: true,
      intent_key: familyKey,
      source: ENTRY_INTENT_KEY_SOURCE.FAMILY_KEY,
    };
  }

  if (legacyConcreteKey) {
    return {
      ok: true,
      intent_key: legacyConcreteKey,
      source: ENTRY_INTENT_KEY_SOURCE.LEGACY_CONCRETE_KEY,
    };
  }

  return buildSchemaError(
    "block_spec requires one of: intent_key, family_key, legacy_concrete_key"
  );
}

function createPlannerEntryTranslator() {
  function translateBlockSpec(rawBlockSpec) {
    if (!rawBlockSpec || typeof rawBlockSpec !== "object" || Array.isArray(rawBlockSpec)) {
      return buildSchemaError("block_spec must be a plain object");
    }
    const sourceBlockSpec = normalizeObject(rawBlockSpec);
    const intentOutcome = resolveIntentKey(sourceBlockSpec);
    if (!intentOutcome.ok) {
      return intentOutcome;
    }

    const translatedBlockSpec = {
      ...sourceBlockSpec,
      intent_key: intentOutcome.intent_key,
    };
    delete translatedBlockSpec.family_key;
    delete translatedBlockSpec.legacy_concrete_key;

    return {
      ok: true,
      block_spec: translatedBlockSpec,
      translation_meta: {
        translator_version: PLANNER_ENTRY_TRANSLATOR_VERSION,
        intent_key_source: intentOutcome.source,
        translated_intent_key: intentOutcome.intent_key,
      },
    };
  }

  return {
    version: PLANNER_ENTRY_TRANSLATOR_VERSION,
    translateBlockSpec,
  };
}

module.exports = {
  PLANNER_ENTRY_TRANSLATOR_VERSION,
  ENTRY_INTENT_KEY_SOURCE,
  createPlannerEntryTranslator,
};
