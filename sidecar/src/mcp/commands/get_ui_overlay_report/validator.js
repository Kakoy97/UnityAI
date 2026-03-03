"use strict";

const {
  isObject,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

function fail(message, errorCode = "E_SCHEMA_INVALID", statusCode = 400) {
  return {
    ok: false,
    errorCode,
    message,
    statusCode,
  };
}

function validateGetUiOverlayReport(body) {
  if (!isObject(body)) {
    return fail("Body must be a JSON object");
  }

  const keysValidation = validateAllowedKeys(
    body,
    new Set([
      "root_path",
      "scope",
      "include_inactive",
      "include_children_summary",
      "max_nodes",
      "max_children_per_canvas",
      "timeout_ms",
    ]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (
    body.root_path !== undefined &&
    body.root_path !== null &&
    typeof body.root_path !== "string"
  ) {
    return fail("root_path must be a string when provided");
  }

  if (body.scope !== undefined) {
    if (!isObject(body.scope)) {
      return fail("scope must be an object when provided");
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
      return fail("scope.root_path must be a string when provided");
    }

    const topLevelRootPath =
      typeof body.root_path === "string" ? body.root_path.trim() : "";
    const scopeRootPath =
      typeof body.scope.root_path === "string" ? body.scope.root_path.trim() : "";
    if (
      topLevelRootPath &&
      scopeRootPath &&
      topLevelRootPath !== scopeRootPath
    ) {
      return fail("root_path and scope.root_path must match when both provided");
    }
  }

  if (
    body.include_inactive !== undefined &&
    typeof body.include_inactive !== "boolean"
  ) {
    return fail("include_inactive must be a boolean when provided");
  }

  if (
    body.include_children_summary !== undefined &&
    typeof body.include_children_summary !== "boolean"
  ) {
    return fail("include_children_summary must be a boolean when provided");
  }

  if (body.max_nodes !== undefined) {
    const maxNodesValidation = validateIntegerField(body.max_nodes, 1, "max_nodes");
    if (!maxNodesValidation.ok) {
      return maxNodesValidation;
    }
  }

  if (body.max_children_per_canvas !== undefined) {
    const maxChildrenValidation = validateIntegerField(
      body.max_children_per_canvas,
      1,
      "max_children_per_canvas"
    );
    if (!maxChildrenValidation.ok) {
      return maxChildrenValidation;
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
  validateGetUiOverlayReport,
};
