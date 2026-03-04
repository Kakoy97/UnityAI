"use strict";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateAllowedKeys(obj, allowedSet, fieldPath) {
  if (!isObject(obj)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} must be an object`,
      statusCode: 400,
    };
  }
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (!allowedSet.has(key)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath} has unexpected field: ${key}`,
        statusCode: 400,
      };
    }
  }
  return { ok: true };
}

function validateMcpListAssetsInFolder(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set(["folder_path", "recursive", "include_meta", "limit"]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(body.folder_path)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "folder_path is required",
      statusCode: 400,
    };
  }

  if (body.recursive !== undefined && typeof body.recursive !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "recursive must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (body.include_meta !== undefined && typeof body.include_meta !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_meta must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (
    body.limit !== undefined &&
    (!Number.isFinite(Number(body.limit)) ||
      Math.floor(Number(body.limit)) !== Number(body.limit) ||
      Number(body.limit) < 1)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "limit must be an integer >= 1 when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateMcpGetSceneRoots(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set(["scene_path", "include_inactive"]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (
    body.scene_path !== undefined &&
    body.scene_path !== null &&
    typeof body.scene_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "scene_path must be a string when provided",
      statusCode: 400,
    };
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

  return { ok: true };
}

function validateMcpFindObjectsByComponent(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set([
    "component_query",
    "scene_path",
    "under_path",
    "include_inactive",
    "limit",
  ]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(body.component_query)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "component_query is required",
      statusCode: 400,
    };
  }

  if (
    body.scene_path !== undefined &&
    body.scene_path !== null &&
    typeof body.scene_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "scene_path must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    body.under_path !== undefined &&
    body.under_path !== null &&
    typeof body.under_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "under_path must be a string when provided",
      statusCode: 400,
    };
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
    body.limit !== undefined &&
    (!Number.isFinite(Number(body.limit)) ||
      Math.floor(Number(body.limit)) !== Number(body.limit) ||
      Number(body.limit) < 1)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "limit must be an integer >= 1 when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateMcpQueryPrefabInfo(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set([
    "prefab_path",
    "max_depth",
    "node_budget",
    "char_budget",
    "include_components",
    "include_missing_scripts",
  ]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
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

  if (
    !Number.isFinite(Number(body.max_depth)) ||
    Math.floor(Number(body.max_depth)) !== Number(body.max_depth) ||
    Number(body.max_depth) < 0
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "max_depth must be an integer >= 0",
      statusCode: 400,
    };
  }

  if (
    body.node_budget !== undefined &&
    (!Number.isFinite(Number(body.node_budget)) ||
      Math.floor(Number(body.node_budget)) !== Number(body.node_budget) ||
      Number(body.node_budget) < 1)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "node_budget must be an integer >= 1 when provided",
      statusCode: 400,
    };
  }

  if (
    body.char_budget !== undefined &&
    (!Number.isFinite(Number(body.char_budget)) ||
      Math.floor(Number(body.char_budget)) !== Number(body.char_budget) ||
      Number(body.char_budget) < 256)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "char_budget must be an integer >= 256 when provided",
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
  validateMcpListAssetsInFolder,
  validateMcpGetSceneRoots,
  validateMcpFindObjectsByComponent,
  validateMcpQueryPrefabInfo,
};
