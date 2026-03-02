"use strict";

const {
  isObject,
  isNonEmptyString,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

function validateQueryPrefabInfo(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const keysValidation = validateAllowedKeys(
    body,
    new Set([
      "prefab_path",
      "max_depth",
      "node_budget",
      "char_budget",
      "include_components",
      "include_missing_scripts",
    ]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(body.prefab_path)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "prefab_path is required",
      statusCode: 400,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(body, "max_depth")) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "max_depth is required",
      statusCode: 400,
    };
  }

  const maxDepthValidation = validateIntegerField(body.max_depth, 0, "max_depth");
  if (!maxDepthValidation.ok) {
    return maxDepthValidation;
  }

  if (body.node_budget !== undefined) {
    const nodeBudgetValidation = validateIntegerField(
      body.node_budget,
      1,
      "node_budget"
    );
    if (!nodeBudgetValidation.ok) {
      return nodeBudgetValidation;
    }
  }

  if (body.char_budget !== undefined) {
    const charBudgetValidation = validateIntegerField(
      body.char_budget,
      256,
      "char_budget"
    );
    if (!charBudgetValidation.ok) {
      return charBudgetValidation;
    }
  }

  if (
    body.include_components !== undefined &&
    typeof body.include_components !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_components must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (
    body.include_missing_scripts !== undefined &&
    typeof body.include_missing_scripts !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_missing_scripts must be a boolean when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

module.exports = {
  validateQueryPrefabInfo,
};

