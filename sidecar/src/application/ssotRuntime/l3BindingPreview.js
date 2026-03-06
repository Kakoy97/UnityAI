"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SSOT_DTOS_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l3/SsotDtos.generated.cs"
);
const DEFAULT_SSOT_BINDINGS_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l3/SsotBindings.generated.cs"
);

function pascalCase(input) {
  const joined = String(input || "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join("");
  if (!joined) {
    return "Unnamed";
  }
  if (/^\d/.test(joined)) {
    return `N${joined}`;
  }
  return joined;
}

function readTextFileOrThrow(filePath, label) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read ${label} at ${filePath}: ${error.message}`);
  }
}

function escapeRegex(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCSharpAtPrefix(fieldName) {
  return String(fieldName || "").replace(/^@/, "");
}

function extractClassBody(source, className) {
  const pattern = new RegExp(
    `public\\s+sealed\\s+class\\s+${escapeRegex(className)}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
    "m"
  );
  const match = String(source || "").match(pattern);
  return match ? match[1] : "";
}

function extractDtoFieldNames(dtosSource, className) {
  const classBody = extractClassBody(dtosSource, className);
  if (!classBody) {
    return [];
  }
  const names = [];
  const fieldPattern =
    /public\s+(?!const\b)(?!static\b)[A-Za-z0-9_<>\[\]@]+\s+([@A-Za-z_][A-Za-z0-9_]*)\s*;/g;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = fieldPattern.exec(classBody))) {
    names.push(stripCSharpAtPrefix(match[1]));
  }
  return names;
}

function hasRouteCase(bindingsSource, className) {
  const text = String(bindingsSource || "");
  const caseLine = `case ${className}.ToolName:`;
  const callLine = `TryDeserialize<${className}>`;
  return text.includes(caseLine) && text.includes(callLine);
}

function simulateTryDeserializeByToolName(toolName, payload, options = {}) {
  const normalizedToolName = typeof toolName === "string" ? toolName.trim() : "";
  if (!normalizedToolName) {
    return {
      ok: false,
      error_code: "E_SSOT_L3_ROUTE_PREVIEW_INVALID",
      message: "toolName is required for L3 route preview",
      route_matched: false,
      dropped_fields: [],
      mapped_fields: [],
      mapped_payload: {},
    };
  }
  const dtoPath = options.dtoPath
    ? path.resolve(String(options.dtoPath))
    : DEFAULT_SSOT_DTOS_PATH;
  const bindingsPath = options.bindingsPath
    ? path.resolve(String(options.bindingsPath))
    : DEFAULT_SSOT_BINDINGS_PATH;

  const dtosSource = readTextFileOrThrow(dtoPath, "SSOT DTO artifact");
  const bindingsSource = readTextFileOrThrow(bindingsPath, "SSOT binding artifact");

  const className = `${pascalCase(normalizedToolName)}RequestDto`;
  const dtoFieldNames = extractDtoFieldNames(dtosSource, className);
  const routeMatched = hasRouteCase(bindingsSource, className);
  const sourcePayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : {};
  const payloadKeys = Object.keys(sourcePayload);
  const mappedPayload = {};
  for (const name of dtoFieldNames) {
    if (Object.prototype.hasOwnProperty.call(sourcePayload, name)) {
      mappedPayload[name] = sourcePayload[name];
    }
  }
  const droppedFields = payloadKeys.filter((key) => !dtoFieldNames.includes(key));
  const ok = routeMatched && droppedFields.length === 0;

  let errorCode = "";
  if (!routeMatched) {
    errorCode = "E_SSOT_L3_ROUTE_PREVIEW_MISSING";
  } else if (droppedFields.length > 0) {
    errorCode = "E_SSOT_L3_ROUTE_PREVIEW_FIELD_DROPPED";
  }

  return {
    ok,
    error_code: errorCode,
    message: ok
      ? "L3 route preview succeeded"
      : !routeMatched
        ? `L3 route case missing for ${className}`
        : `L3 DTO would drop fields: ${droppedFields.join(", ")}`,
    route_matched: routeMatched,
    class_name: className,
    dropped_fields: droppedFields,
    mapped_fields: Object.keys(mappedPayload),
    mapped_payload: mappedPayload,
    dto_field_count: dtoFieldNames.length,
  };
}

module.exports = {
  DEFAULT_SSOT_DTOS_PATH,
  DEFAULT_SSOT_BINDINGS_PATH,
  simulateTryDeserializeByToolName,
};

