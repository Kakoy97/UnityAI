"use strict";

const {
  isObject,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

const ALLOWED_UI_SYSTEMS = new Set(["auto", "ugui", "uitk"]);

function validateGetUiTree(body) {
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
      "ui_system",
      "root_path",
      "scope",
      "include_inactive",
      "include_components",
      "include_layout",
      "include_interaction",
      "include_text_metrics",
      "max_depth",
      "node_budget",
      "char_budget",
      "resolution",
      "timeout_ms",
    ]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  const uiSystem =
    typeof body.ui_system === "string" ? body.ui_system.trim() : "";
  if (uiSystem && !ALLOWED_UI_SYSTEMS.has(uiSystem)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "ui_system must be one of: auto|ugui|uitk",
      statusCode: 400,
    };
  }

  if (
    body.root_path !== undefined &&
    body.root_path !== null &&
    typeof body.root_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "root_path must be a string when provided",
      statusCode: 400,
    };
  }

  if (body.scope !== undefined) {
    if (!isObject(body.scope)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "scope must be an object when provided",
        statusCode: 400,
      };
    }
    const scopeKeysValidation = validateAllowedKeys(
      body.scope,
      new Set(["root_path"]),
      "scope"
    );
    if (!scopeKeysValidation.ok) {
      return scopeKeysValidation;
    }
    if (
      body.scope.root_path !== undefined &&
      body.scope.root_path !== null &&
      typeof body.scope.root_path !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "scope.root_path must be a string when provided",
        statusCode: 400,
      };
    }
    if (
      typeof body.root_path === "string" &&
      body.root_path.trim() &&
      typeof body.scope.root_path === "string" &&
      body.scope.root_path.trim() &&
      body.root_path.trim() !== body.scope.root_path.trim()
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "root_path and scope.root_path must match when both provided",
        statusCode: 400,
      };
    }
  }

  if (
    body.include_inactive !== undefined &&
    typeof body.include_inactive !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_inactive must be a boolean when provided",
      statusCode: 400,
    };
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
    body.include_layout !== undefined &&
    typeof body.include_layout !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_layout must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (
    body.include_interaction !== undefined &&
    typeof body.include_interaction !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_interaction must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (
    body.include_text_metrics !== undefined &&
    typeof body.include_text_metrics !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_text_metrics must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (body.max_depth !== undefined) {
    const maxDepthValidation = validateIntegerField(body.max_depth, 0, "max_depth");
    if (!maxDepthValidation.ok) {
      return maxDepthValidation;
    }
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

  if (body.resolution !== undefined) {
    if (!isObject(body.resolution)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "resolution must be an object when provided",
        statusCode: 400,
      };
    }
    const resolutionKeysValidation = validateAllowedKeys(
      body.resolution,
      new Set(["width", "height"]),
      "resolution"
    );
    if (!resolutionKeysValidation.ok) {
      return resolutionKeysValidation;
    }
    if (body.resolution.width !== undefined) {
      const widthValidation = validateIntegerField(
        body.resolution.width,
        1,
        "resolution.width"
      );
      if (!widthValidation.ok) {
        return widthValidation;
      }
    }
    if (body.resolution.height !== undefined) {
      const heightValidation = validateIntegerField(
        body.resolution.height,
        1,
        "resolution.height"
      );
      if (!heightValidation.ok) {
        return heightValidation;
      }
    }
  }

  if (body.timeout_ms !== undefined) {
    const timeoutValidation = validateIntegerField(
      body.timeout_ms,
      1000,
      "timeout_ms"
    );
    if (!timeoutValidation.ok) {
      return timeoutValidation;
    }
  }

  return { ok: true };
}

module.exports = {
  validateGetUiTree,
};
