"use strict";

const {
  isObject,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

const ALLOWED_CHECKS = new Set([
  "OUT_OF_BOUNDS",
  "OVERLAP",
  "NOT_CLICKABLE",
  "TEXT_OVERFLOW",
]);
const ALLOWED_LAYOUT_REFRESH_MODES = new Set(["scoped_roots_only", "full_tree"]);
const ALLOWED_REPAIR_STYLES = new Set(["conservative", "balanced", "aggressive"]);

function validateUiLayout(body) {
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
      "scope",
      "resolutions",
      "checks",
      "max_issues",
      "time_budget_ms",
      "layout_refresh_mode",
      "include_repair_plan",
      "max_repair_suggestions",
      "repair_style",
      "timeout_ms",
    ]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
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
  }

  if (body.resolutions !== undefined) {
    if (!Array.isArray(body.resolutions)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "resolutions must be an array when provided",
        statusCode: 400,
      };
    }
    for (let i = 0; i < body.resolutions.length; i += 1) {
      const item = body.resolutions[i];
      const path = `resolutions[${i}]`;
      if (!isObject(item)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${path} must be an object`,
          statusCode: 400,
        };
      }
      const itemKeysValidation = validateAllowedKeys(
        item,
        new Set(["name", "width", "height"]),
        path
      );
      if (!itemKeysValidation.ok) {
        return itemKeysValidation;
      }
      if (!Object.prototype.hasOwnProperty.call(item, "width")) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${path}.width is required`,
          statusCode: 400,
        };
      }
      if (!Object.prototype.hasOwnProperty.call(item, "height")) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${path}.height is required`,
          statusCode: 400,
        };
      }
      const widthValidation = validateIntegerField(item.width, 1, `${path}.width`);
      if (!widthValidation.ok) {
        return widthValidation;
      }
      const heightValidation = validateIntegerField(item.height, 1, `${path}.height`);
      if (!heightValidation.ok) {
        return heightValidation;
      }
      if (
        item.name !== undefined &&
        item.name !== null &&
        typeof item.name !== "string"
      ) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${path}.name must be a string when provided`,
          statusCode: 400,
        };
      }
    }
  }

  if (body.checks !== undefined) {
    if (!Array.isArray(body.checks)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "checks must be an array when provided",
        statusCode: 400,
      };
    }
    for (let i = 0; i < body.checks.length; i += 1) {
      const check = body.checks[i];
      if (typeof check !== "string" || !ALLOWED_CHECKS.has(check.trim())) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message:
            "checks items must be one of: OUT_OF_BOUNDS|OVERLAP|NOT_CLICKABLE|TEXT_OVERFLOW",
          statusCode: 400,
        };
      }
    }
  }

  if (body.max_issues !== undefined) {
    const maxIssuesValidation = validateIntegerField(body.max_issues, 1, "max_issues");
    if (!maxIssuesValidation.ok) {
      return maxIssuesValidation;
    }
  }

  if (body.time_budget_ms !== undefined) {
    const timeBudgetValidation = validateIntegerField(
      body.time_budget_ms,
      1,
      "time_budget_ms"
    );
    if (!timeBudgetValidation.ok) {
      return timeBudgetValidation;
    }
  }

  if (body.layout_refresh_mode !== undefined) {
    const mode =
      typeof body.layout_refresh_mode === "string"
        ? body.layout_refresh_mode.trim()
        : "";
    if (!ALLOWED_LAYOUT_REFRESH_MODES.has(mode)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "layout_refresh_mode must be one of: scoped_roots_only|full_tree",
        statusCode: 400,
      };
    }
  }

  if (
    body.include_repair_plan !== undefined &&
    typeof body.include_repair_plan !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_repair_plan must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (body.max_repair_suggestions !== undefined) {
    const repairLimitValidation = validateIntegerField(
      body.max_repair_suggestions,
      1,
      "max_repair_suggestions"
    );
    if (!repairLimitValidation.ok) {
      return repairLimitValidation;
    }
  }

  if (body.repair_style !== undefined) {
    const style =
      typeof body.repair_style === "string" ? body.repair_style.trim() : "";
    if (!ALLOWED_REPAIR_STYLES.has(style)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "repair_style must be one of: conservative|balanced|aggressive",
        statusCode: 400,
      };
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
  validateUiLayout,
};
