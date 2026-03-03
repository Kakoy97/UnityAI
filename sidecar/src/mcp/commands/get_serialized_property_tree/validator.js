"use strict";

const {
  isObject,
  isNonEmptyString,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "target_anchor",
  "component_selector",
  "component_selectors",
  "root_property_path",
  "depth",
  "after_property_path",
  "page_size",
  "node_budget",
  "char_budget",
  "include_value_summary",
  "include_non_visible",
  "timeout_ms",
]);

const ALLOWED_ANCHOR_KEYS = new Set(["object_id", "path"]);
const ALLOWED_COMPONENT_SELECTOR_KEYS = new Set([
  "component_assembly_qualified_name",
  "component_index",
]);
const MAX_COMPONENT_SELECTORS = 8;

function fail(message, errorCode = "E_SCHEMA_INVALID", statusCode = 400) {
  return {
    ok: false,
    errorCode,
    message,
    statusCode,
  };
}

function validateAnchor(anchor, fieldPath) {
  if (!isObject(anchor)) {
    return fail(`${fieldPath} must be an object`);
  }

  const keysValidation = validateAllowedKeys(anchor, ALLOWED_ANCHOR_KEYS, fieldPath);
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(anchor.object_id)) {
    return fail(`${fieldPath}.object_id is required`);
  }
  if (!isNonEmptyString(anchor.path)) {
    return fail(`${fieldPath}.path is required`);
  }

  return { ok: true };
}

function validateComponentSelector(selector, fieldPath) {
  if (!isObject(selector)) {
    return fail(`${fieldPath} must be an object`);
  }

  const keysValidation = validateAllowedKeys(
    selector,
    ALLOWED_COMPONENT_SELECTOR_KEYS,
    fieldPath
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(selector.component_assembly_qualified_name)) {
    return fail(`${fieldPath}.component_assembly_qualified_name is required`);
  }

  if (selector.component_index !== undefined) {
    const indexValidation = validateIntegerField(
      selector.component_index,
      0,
      `${fieldPath}.component_index`
    );
    if (!indexValidation.ok) {
      return indexValidation;
    }
  }

  return { ok: true };
}

function validateComponentSelectorArray(selectors, fieldPath) {
  if (!Array.isArray(selectors)) {
    return fail(`${fieldPath} must be an array when provided`);
  }
  if (selectors.length === 0) {
    return fail(`${fieldPath} must contain at least one selector`);
  }
  if (selectors.length > MAX_COMPONENT_SELECTORS) {
    return fail(`${fieldPath} supports at most ${MAX_COMPONENT_SELECTORS} selectors`);
  }
  for (let i = 0; i < selectors.length; i += 1) {
    const itemValidation = validateComponentSelector(
      selectors[i],
      `${fieldPath}[${i}]`
    );
    if (!itemValidation.ok) {
      return itemValidation;
    }
  }
  return { ok: true };
}

function buildSelectorKey(selector) {
  const source = selector && typeof selector === "object" ? selector : {};
  const typeName =
    typeof source.component_assembly_qualified_name === "string"
      ? source.component_assembly_qualified_name.trim()
      : "";
  const index =
    Number.isFinite(Number(source.component_index)) && Number(source.component_index) >= 0
      ? Math.floor(Number(source.component_index))
      : 0;
  return `${typeName}#${index}`;
}

function validateOptionalString(value, fieldName) {
  if (value === undefined || value === null) {
    return { ok: true };
  }
  if (typeof value !== "string") {
    return fail(`${fieldName} must be a string when provided`);
  }
  return { ok: true };
}

function validateOptionalBoolean(value, fieldName) {
  if (value === undefined) {
    return { ok: true };
  }
  if (typeof value !== "boolean") {
    return fail(`${fieldName} must be a boolean when provided`);
  }
  return { ok: true };
}

function validateGetSerializedPropertyTree(body) {
  if (!isObject(body)) {
    return fail("Body must be a JSON object");
  }

  const keysValidation = validateAllowedKeys(body, ALLOWED_TOP_LEVEL_KEYS, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  const anchorValidation = validateAnchor(body.target_anchor, "target_anchor");
  if (!anchorValidation.ok) {
    return anchorValidation;
  }

  const hasSingleSelector = body.component_selector !== undefined;
  const hasManySelectors = body.component_selectors !== undefined;
  if (!hasSingleSelector && !hasManySelectors) {
    return fail("component_selector or component_selectors is required");
  }

  if (hasSingleSelector) {
    const selectorValidation = validateComponentSelector(
      body.component_selector,
      "component_selector"
    );
    if (!selectorValidation.ok) {
      return selectorValidation;
    }
  }

  const selectorKeys = new Set();
  if (hasSingleSelector) {
    selectorKeys.add(buildSelectorKey(body.component_selector));
  }
  if (hasManySelectors) {
    const manyValidation = validateComponentSelectorArray(
      body.component_selectors,
      "component_selectors"
    );
    if (!manyValidation.ok) {
      return manyValidation;
    }
    for (let i = 0; i < body.component_selectors.length; i += 1) {
      selectorKeys.add(buildSelectorKey(body.component_selectors[i]));
    }
  }
  const selectorCount = selectorKeys.size;

  const rootPathValidation = validateOptionalString(
    body.root_property_path,
    "root_property_path"
  );
  if (!rootPathValidation.ok) {
    return rootPathValidation;
  }

  const afterPathValidation = validateOptionalString(
    body.after_property_path,
    "after_property_path"
  );
  if (!afterPathValidation.ok) {
    return afterPathValidation;
  }
  if (selectorCount > 1 && isNonEmptyString(body.after_property_path)) {
    return fail(
      "after_property_path is only supported when querying a single component"
    );
  }

  if (body.depth !== undefined) {
    const depthValidation = validateIntegerField(body.depth, 0, "depth");
    if (!depthValidation.ok) {
      return depthValidation;
    }
  }

  if (body.page_size !== undefined) {
    const pageValidation = validateIntegerField(body.page_size, 1, "page_size");
    if (!pageValidation.ok) {
      return pageValidation;
    }
  }

  if (body.node_budget !== undefined) {
    const nodeValidation = validateIntegerField(
      body.node_budget,
      1,
      "node_budget"
    );
    if (!nodeValidation.ok) {
      return nodeValidation;
    }
  }

  if (body.char_budget !== undefined) {
    const charValidation = validateIntegerField(
      body.char_budget,
      256,
      "char_budget"
    );
    if (!charValidation.ok) {
      return charValidation;
    }
  }

  const includeSummaryValidation = validateOptionalBoolean(
    body.include_value_summary,
    "include_value_summary"
  );
  if (!includeSummaryValidation.ok) {
    return includeSummaryValidation;
  }

  const includeNonVisibleValidation = validateOptionalBoolean(
    body.include_non_visible,
    "include_non_visible"
  );
  if (!includeNonVisibleValidation.ok) {
    return includeNonVisibleValidation;
  }

  if (body.timeout_ms !== undefined) {
    const timeoutValidation = validateIntegerField(body.timeout_ms, 1000, "timeout_ms");
    if (!timeoutValidation.ok) {
      return timeoutValidation;
    }
  }

  return { ok: true };
}

module.exports = {
  validateGetSerializedPropertyTree,
};
