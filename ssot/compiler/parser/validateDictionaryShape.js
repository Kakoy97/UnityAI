"use strict";

function normalizeKind(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || "write";
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
  }
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be boolean`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isFinite(Number(value)) || Math.floor(Number(value)) < 1) {
    throw new Error(`${label} must be an integer >= 1`);
  }
}

function assertEnum(value, allowedValues, label) {
  const allowed = Array.isArray(allowedValues) ? allowedValues : [];
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join("|")}`);
  }
}

function validateErrorContextContract(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertNonEmptyString(value.error_context_version, `${label}.error_context_version`);

  const transactionFailure = value.transaction_failure;
  if (!isPlainObject(transactionFailure)) {
    throw new Error(`${label}.transaction_failure must be an object`);
  }
  assertStringArray(
    transactionFailure.required_fields,
    `${label}.transaction_failure.required_fields`
  );
  for (const requiredField of [
    "failed_step_id",
    "failed_tool_name",
    "failed_error_code",
  ]) {
    if (!transactionFailure.required_fields.includes(requiredField)) {
      throw new Error(
        `${label}.transaction_failure.required_fields must include '${requiredField}'`
      );
    }
  }

  const anchorConflict = value.anchor_conflict;
  if (!isPlainObject(anchorConflict)) {
    throw new Error(`${label}.anchor_conflict must be an object`);
  }
  assertStringArray(
    anchorConflict.required_fields,
    `${label}.anchor_conflict.required_fields`
  );
  for (const requiredField of [
    "ambiguity_kind",
    "resolved_candidates_count",
    "path_candidate_path",
    "path_candidate_object_id",
    "object_id_candidate_path",
    "object_id_candidate_object_id",
  ]) {
    if (!anchorConflict.required_fields.includes(requiredField)) {
      throw new Error(
        `${label}.anchor_conflict.required_fields must include '${requiredField}'`
      );
    }
  }
}

function validateRecoveryActionContract(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const dependencyValidation = value.dependency_validation;
  if (!isPlainObject(dependencyValidation)) {
    throw new Error(`${label}.dependency_validation must be an object`);
  }
  assertBoolean(
    dependencyValidation.check_cycles,
    `${label}.dependency_validation.check_cycles`
  );
  assertPositiveInteger(
    dependencyValidation.max_depth,
    `${label}.dependency_validation.max_depth`
  );
  assertEnum(
    dependencyValidation.on_cycle_detected,
    ["fail_fast"],
    `${label}.dependency_validation.on_cycle_detected`
  );

  const contextValidity = value.context_validity;
  if (!isPlainObject(contextValidity)) {
    throw new Error(`${label}.context_validity must be an object`);
  }
  assertPositiveInteger(
    contextValidity.ttl_seconds,
    `${label}.context_validity.ttl_seconds`
  );
  assertBoolean(
    contextValidity.context_snapshot,
    `${label}.context_validity.context_snapshot`
  );
  assertNonEmptyString(
    contextValidity.requires_context_refresh_field,
    `${label}.context_validity.requires_context_refresh_field`
  );

  const fallbackStrategy = value.fallback_strategy;
  if (!isPlainObject(fallbackStrategy)) {
    throw new Error(`${label}.fallback_strategy must be an object`);
  }
  assertStringArray(
    fallbackStrategy.allowed,
    `${label}.fallback_strategy.allowed`
  );
  assertNonEmptyString(
    fallbackStrategy.default,
    `${label}.fallback_strategy.default`
  );
  if (!fallbackStrategy.allowed.includes(fallbackStrategy.default)) {
    throw new Error(
      `${label}.fallback_strategy.default must be included in fallback_strategy.allowed`
    );
  }
}

function validateAmbiguityResolutionPolicyContract(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const anchorConflictPolicy = value.anchor_conflict;
  if (!isPlainObject(anchorConflictPolicy)) {
    throw new Error(`${label}.anchor_conflict must be an object`);
  }
  assertNonEmptyString(
    anchorConflictPolicy.resolution_mode,
    `${label}.anchor_conflict.resolution_mode`
  );
  assertStringArray(
    anchorConflictPolicy.required_actions,
    `${label}.anchor_conflict.required_actions`
  );

  const nameCollisionPolicy = value.name_collision;
  if (!isPlainObject(nameCollisionPolicy)) {
    throw new Error(`${label}.name_collision must be an object`);
  }
  assertStringArray(
    nameCollisionPolicy.allowed_policies,
    `${label}.name_collision.allowed_policies`
  );
  assertNonEmptyString(
    nameCollisionPolicy.default_policy,
    `${label}.name_collision.default_policy`
  );
  if (!nameCollisionPolicy.allowed_policies.includes(nameCollisionPolicy.default_policy)) {
    throw new Error(
      `${label}.name_collision.default_policy must be included in allowed_policies`
    );
  }
}

function validateTransactionWriteFamily(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const rollbackPolicy = value.rollback_policy;
  if (!isPlainObject(rollbackPolicy)) {
    throw new Error(`${label}.rollback_policy must be an object`);
  }
  assertEnum(
    rollbackPolicy.on_step_failure,
    ["rollback_all", "rollback_none", "rollback_partial"],
    `${label}.rollback_policy.on_step_failure`
  );
}

function validateAnchorWriteFamily(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertNonEmptyString(
    value.conflict_error_code,
    `${label}.conflict_error_code`
  );
  assertBoolean(
    value.requires_ambiguity_kind,
    `${label}.requires_ambiguity_kind`
  );
}

function validateCreateFamily(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const preCheckPolicy = value.pre_check_policy;
  if (!isPlainObject(preCheckPolicy)) {
    throw new Error(`${label}.pre_check_policy must be an object`);
  }
  assertBoolean(
    preCheckPolicy.check_existing,
    `${label}.pre_check_policy.check_existing`
  );
  assertEnum(
    preCheckPolicy.on_conflict,
    ["fail", "suffix", "reuse"],
    `${label}.pre_check_policy.on_conflict`
  );
  assertBoolean(
    preCheckPolicy.return_candidates,
    `${label}.pre_check_policy.return_candidates`
  );
  if (Object.prototype.hasOwnProperty.call(preCheckPolicy, "policy_field")) {
    assertNonEmptyString(
      preCheckPolicy.policy_field,
      `${label}.pre_check_policy.policy_field`
    );
  }
}

function validateErrorFeedbackContract(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertNonEmptyString(value.catalog_version, `${label}.catalog_version`);

  const defaults = value.defaults;
  if (!isPlainObject(defaults)) {
    throw new Error(`${label}.defaults must be an object`);
  }
  assertNonEmptyString(
    defaults.fallback_suggestion,
    `${label}.defaults.fallback_suggestion`
  );
  assertNonEmptyString(
    defaults.timeout_suggestion,
    `${label}.defaults.timeout_suggestion`
  );

  assertStringArray(value.anchor_error_codes, `${label}.anchor_error_codes`);
  const anchorCodeSet = new Set(
    value.anchor_error_codes.map((item) => String(item).trim().toUpperCase())
  );
  if (anchorCodeSet.size <= 0) {
    throw new Error(`${label}.anchor_error_codes must not be empty`);
  }

  const templates = value.error_templates;
  if (!isPlainObject(templates)) {
    throw new Error(`${label}.error_templates must be an object`);
  }
  const templateEntries = Object.entries(templates);
  if (templateEntries.length <= 0) {
    throw new Error(`${label}.error_templates must not be empty`);
  }

  const templateCodeSet = new Set();
  for (const [errorCode, template] of templateEntries) {
    const normalizedErrorCode = String(errorCode || "").trim().toUpperCase();
    if (!normalizedErrorCode) {
      throw new Error(`${label}.error_templates contains empty error code key`);
    }
    templateCodeSet.add(normalizedErrorCode);
    if (!isPlainObject(template)) {
      throw new Error(`${label}.error_templates.${normalizedErrorCode} must be an object`);
    }
    assertBoolean(
      template.recoverable,
      `${label}.error_templates.${normalizedErrorCode}.recoverable`
    );
    assertNonEmptyString(
      template.suggestion,
      `${label}.error_templates.${normalizedErrorCode}.suggestion`
    );
  }

  for (const anchorCode of anchorCodeSet) {
    if (!templateCodeSet.has(anchorCode)) {
      throw new Error(
        `${label}.anchor_error_codes requires matching error_templates entry for '${anchorCode}'`
      );
    }
  }
}

function validateGlobalDefinitions(definitions) {
  if (!isPlainObject(definitions)) {
    throw new Error("Dictionary missing required field: _definitions (object)");
  }

  validateErrorContextContract(
    definitions.error_context_contract,
    "_definitions.error_context_contract"
  );
  validateRecoveryActionContract(
    definitions.recovery_action_contract,
    "_definitions.recovery_action_contract"
  );
  validateAmbiguityResolutionPolicyContract(
    definitions.ambiguity_resolution_policy_contract,
    "_definitions.ambiguity_resolution_policy_contract"
  );
  validateTransactionWriteFamily(
    definitions.transaction_write_family,
    "_definitions.transaction_write_family"
  );
  validateAnchorWriteFamily(
    definitions.anchor_write_family,
    "_definitions.anchor_write_family"
  );
  validateCreateFamily(
    definitions.create_family,
    "_definitions.create_family"
  );
  validateErrorFeedbackContract(
    definitions.error_feedback_contract,
    "_definitions.error_feedback_contract"
  );
}

function validateExamplesPositive(value, label) {
  if (!Array.isArray(value) || value.length <= 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  for (const [index, item] of value.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    assertNonEmptyString(item.scenario, `${label}[${index}].scenario`);
    assertNonEmptyString(
      item.example_revision,
      `${label}[${index}].example_revision`
    );
    if (
      !Object.prototype.hasOwnProperty.call(item, "request") ||
      !isPlainObject(item.request)
    ) {
      throw new Error(`${label}[${index}].request must be an object`);
    }
    if (Object.prototype.hasOwnProperty.call(item, "context_tags")) {
      assertStringArray(item.context_tags, `${label}[${index}].context_tags`);
    }
  }
}

function validateExamplesNegative(value, label) {
  if (!Array.isArray(value) || value.length <= 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  for (const [index, item] of value.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    assertNonEmptyString(item.error_code, `${label}[${index}].error_code`);
    assertNonEmptyString(item.fix_hint, `${label}[${index}].fix_hint`);
    if (!Object.prototype.hasOwnProperty.call(item, "wrong_payload_fragment")) {
      throw new Error(
        `${label}[${index}].wrong_payload_fragment is required`
      );
    }
  }
}

function validateSingleCommonErrorFix(
  errorCode,
  fix,
  label,
  toolNameSet,
  options = {}
) {
  const allowNestedRoutes = options.allowNestedRoutes !== false;
  if (!isPlainObject(fix)) {
    throw new Error(`${label}.${errorCode} must be an object`);
  }
  assertNonEmptyString(
    fix.suggested_action,
    `${label}.${errorCode}.suggested_action`
  );
  if (!toolNameSet.has(fix.suggested_action.trim())) {
    throw new Error(
      `${label}.${errorCode}.suggested_action references unknown tool '${fix.suggested_action}'`
    );
  }
  if (Object.prototype.hasOwnProperty.call(fix, "suggested_tool")) {
    assertNonEmptyString(
      fix.suggested_tool,
      `${label}.${errorCode}.suggested_tool`
    );
    if (!toolNameSet.has(fix.suggested_tool.trim())) {
      throw new Error(
        `${label}.${errorCode}.suggested_tool references unknown tool '${fix.suggested_tool}'`
      );
    }
  }
  assertNonEmptyString(fix.fix_hint, `${label}.${errorCode}.fix_hint`);
  let hasFixSteps = false;
  if (Object.prototype.hasOwnProperty.call(fix, "execution_order")) {
    assertEnum(
      fix.execution_order,
      ["sequential", "parallel"],
      `${label}.${errorCode}.execution_order`
    );
  }
  if (Object.prototype.hasOwnProperty.call(fix, "failure_handling")) {
    assertEnum(
      fix.failure_handling,
      ["stop_on_first_failure", "continue"],
      `${label}.${errorCode}.failure_handling`
    );
  }
  if (Object.prototype.hasOwnProperty.call(fix, "requires_context_refresh")) {
    assertBoolean(
      fix.requires_context_refresh,
      `${label}.${errorCode}.requires_context_refresh`
    );
  }
  if (Object.prototype.hasOwnProperty.call(fix, "verification")) {
    if (!isPlainObject(fix.verification)) {
      throw new Error(`${label}.${errorCode}.verification must be an object`);
    }
    if (Object.prototype.hasOwnProperty.call(fix.verification, "auto_verify")) {
      assertBoolean(
        fix.verification.auto_verify,
        `${label}.${errorCode}.verification.auto_verify`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(fix.verification, "verification_tool")
    ) {
      assertNonEmptyString(
        fix.verification.verification_tool,
        `${label}.${errorCode}.verification.verification_tool`
      );
      if (!toolNameSet.has(fix.verification.verification_tool.trim())) {
        throw new Error(
          `${label}.${errorCode}.verification.verification_tool references unknown tool '${fix.verification.verification_tool}'`
        );
      }
    }
    if (
      Object.prototype.hasOwnProperty.call(
        fix.verification,
        "verification_criteria"
      )
    ) {
      assertNonEmptyString(
        fix.verification.verification_criteria,
        `${label}.${errorCode}.verification.verification_criteria`
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(fix, "context_required")) {
    assertStringArray(
      fix.context_required,
      `${label}.${errorCode}.context_required`
    );
  }
  if (Object.prototype.hasOwnProperty.call(fix, "fix_steps")) {
    if (!Array.isArray(fix.fix_steps) || fix.fix_steps.length <= 0) {
      throw new Error(`${label}.${errorCode}.fix_steps must be a non-empty array`);
    }
    hasFixSteps = true;
    let lastStepIndex = 0;
    const seenStepNumbers = new Set();
    for (const [index, step] of fix.fix_steps.entries()) {
      if (!isPlainObject(step)) {
        throw new Error(`${label}.${errorCode}.fix_steps[${index}] must be an object`);
      }
      if (!Number.isFinite(Number(step.step)) || Number(step.step) < 1) {
        throw new Error(`${label}.${errorCode}.fix_steps[${index}].step must be >= 1`);
      }
      const normalizedStep = Math.floor(Number(step.step));
      if (normalizedStep <= lastStepIndex) {
        throw new Error(
          `${label}.${errorCode}.fix_steps[${index}].step must be strictly increasing`
        );
      }
      lastStepIndex = normalizedStep;
      assertNonEmptyString(
        step.tool,
        `${label}.${errorCode}.fix_steps[${index}].tool`
      );
      if (!toolNameSet.has(step.tool.trim())) {
        throw new Error(
          `${label}.${errorCode}.fix_steps[${index}].tool references unknown tool '${step.tool}'`
        );
      }
      if (Object.prototype.hasOwnProperty.call(step, "idempotent")) {
        assertBoolean(
          step.idempotent,
          `${label}.${errorCode}.fix_steps[${index}].idempotent`
        );
      }
      if (Object.prototype.hasOwnProperty.call(step, "depends_on")) {
        if (!Array.isArray(step.depends_on)) {
          throw new Error(
            `${label}.${errorCode}.fix_steps[${index}].depends_on must be an array`
          );
        }
        for (const [depIndex, depStepNumber] of step.depends_on.entries()) {
          if (
            !Number.isFinite(Number(depStepNumber)) ||
            Math.floor(Number(depStepNumber)) < 1
          ) {
            throw new Error(
              `${label}.${errorCode}.fix_steps[${index}].depends_on[${depIndex}] must be an integer >= 1`
            );
          }
          const normalizedDepStep = Math.floor(Number(depStepNumber));
          if (!seenStepNumbers.has(normalizedDepStep)) {
            throw new Error(
              `${label}.${errorCode}.fix_steps[${index}].depends_on[${depIndex}] references unknown or forward step '${depStepNumber}'`
            );
          }
        }
      }
      seenStepNumbers.add(normalizedStep);
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(fix, "auto_fixable") &&
    typeof fix.auto_fixable !== "boolean"
  ) {
    throw new Error(`${label}.${errorCode}.auto_fixable must be boolean`);
  }
  if (fix.auto_fixable === true && !hasFixSteps) {
    throw new Error(
      `${label}.${errorCode}.auto_fixable=true requires non-empty fix_steps`
    );
  }

  if (Object.prototype.hasOwnProperty.call(fix, "nested_error_routes")) {
    if (!allowNestedRoutes) {
      throw new Error(
        `${label}.${errorCode}.nested_error_routes is only allowed on top-level common_error_fixes entries`
      );
    }
    if (!isPlainObject(fix.nested_error_routes)) {
      throw new Error(`${label}.${errorCode}.nested_error_routes must be an object`);
    }
    for (const [nestedErrorCode, nestedFix] of Object.entries(
      fix.nested_error_routes
    )) {
      validateSingleCommonErrorFix(
        nestedErrorCode,
        nestedFix,
        `${label}.${errorCode}.nested_error_routes`,
        toolNameSet,
        { allowNestedRoutes: false }
      );
    }
  }
}

function validateCommonErrorFixes(value, label, toolNameSet) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const [errorCode, fix] of Object.entries(value)) {
    validateSingleCommonErrorFix(errorCode, fix, label, toolNameSet, {
      allowNestedRoutes: true,
    });
  }
}

function validateToolCombinations(value, label, toolNameSet) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  for (const [index, item] of value.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    assertNonEmptyString(item.scenario, `${label}[${index}].scenario`);
    assertStringArray(item.tools, `${label}[${index}].tools`);
    if (Array.isArray(item.order)) {
      assertStringArray(item.order, `${label}[${index}].order`);
    }
    for (const toolName of item.tools) {
      if (!toolNameSet.has(toolName)) {
        throw new Error(
          `${label}[${index}].tools contains unknown tool '${toolName}'`
        );
      }
    }
    if (
      Object.prototype.hasOwnProperty.call(item, "failure_handling") &&
      !isPlainObject(item.failure_handling)
    ) {
      throw new Error(`${label}[${index}].failure_handling must be an object`);
    }
    if (isPlainObject(item.failure_handling)) {
      const afterWriteFailure = item.failure_handling.after_write_failure;
      if (afterWriteFailure !== undefined) {
        if (!isPlainObject(afterWriteFailure)) {
          throw new Error(
            `${label}[${index}].failure_handling.after_write_failure must be an object`
          );
        }
        assertNonEmptyString(
          afterWriteFailure.required_action,
          `${label}[${index}].failure_handling.after_write_failure.required_action`
        );
        if (!toolNameSet.has(afterWriteFailure.required_action.trim())) {
          throw new Error(
            `${label}[${index}].failure_handling.after_write_failure.required_action references unknown tool '${afterWriteFailure.required_action}'`
          );
        }
        if (Object.prototype.hasOwnProperty.call(afterWriteFailure, "reason")) {
          assertNonEmptyString(
            afterWriteFailure.reason,
            `${label}[${index}].failure_handling.after_write_failure.reason`
          );
        }
      }

      const afterSaveFailure = item.failure_handling.after_save_failure;
      if (afterSaveFailure !== undefined) {
        if (!isPlainObject(afterSaveFailure)) {
          throw new Error(
            `${label}[${index}].failure_handling.after_save_failure must be an object`
          );
        }
        if (Object.prototype.hasOwnProperty.call(afterSaveFailure, "retry_policy")) {
          assertNonEmptyString(
            afterSaveFailure.retry_policy,
            `${label}[${index}].failure_handling.after_save_failure.retry_policy`
          );
        }
        if (Object.prototype.hasOwnProperty.call(afterSaveFailure, "note")) {
          assertNonEmptyString(
            afterSaveFailure.note,
            `${label}[${index}].failure_handling.after_save_failure.note`
          );
        }
      }
    }
  }
}

function validatePropertyPathRules(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertNonEmptyString(value.format, `${label}.format`);
  assertNonEmptyString(value.discovery_tool, `${label}.discovery_tool`);
  if (Object.prototype.hasOwnProperty.call(value, "prefix")) {
    assertNonEmptyString(value.prefix, `${label}.prefix`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "nested_separator")) {
    assertNonEmptyString(value.nested_separator, `${label}.nested_separator`);
  }
}

function detectRelatedToolCycles(graph) {
  const stateByNode = new Map();
  const stack = [];

  function visit(node) {
    const state = stateByNode.get(node) || 0;
    if (state === 1) {
      const start = stack.indexOf(node);
      const cycleNodes = start >= 0 ? stack.slice(start).concat(node) : [node, node];
      throw new Error(`related_tools cycle detected: ${cycleNodes.join(" -> ")}`);
    }
    if (state === 2) {
      return;
    }

    stateByNode.set(node, 1);
    stack.push(node);
    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      visit(neighbor);
    }
    stack.pop();
    stateByNode.set(node, 2);
  }

  for (const node of graph.keys()) {
    visit(node);
  }
}

function validateDictionaryShape(dictionary) {
  if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary)) {
    throw new Error("Dictionary root must be an object");
  }
  if (!Object.prototype.hasOwnProperty.call(dictionary, "version")) {
    throw new Error("Dictionary missing required field: version");
  }
  if (!Array.isArray(dictionary.tools)) {
    throw new Error("Dictionary missing required field: tools (array)");
  }
  const toolNameSet = new Set(
    dictionary.tools
      .map((item) =>
        item && typeof item.name === "string" ? item.name.trim() : ""
      )
      .filter((item) => item.length > 0)
  );
  const relatedGraph = new Map();
  validateGlobalDefinitions(dictionary._definitions);

  for (const [index, tool] of dictionary.tools.entries()) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      throw new Error(`tools[${index}] must be an object`);
    }
    if (typeof tool.name !== "string" || !tool.name.trim()) {
      throw new Error(`tools[${index}].name must be a non-empty string`);
    }
    if (!tool.input || typeof tool.input !== "object" || Array.isArray(tool.input)) {
      throw new Error(`tools[${index}].input must be an object`);
    }

    const kind = normalizeKind(tool.kind);
    if (kind === "write") {
      const transaction =
        tool.transaction && typeof tool.transaction === "object" && !Array.isArray(tool.transaction)
          ? tool.transaction
          : null;
      if (!transaction) {
        throw new Error(
          `tools[${index}](${tool.name.trim()}).transaction is required for write tools`
        );
      }
      if (typeof transaction.enabled !== "boolean") {
        throw new Error(
          `tools[${index}](${tool.name.trim()}).transaction.enabled must be boolean`
        );
      }
      if (typeof transaction.undo_safe !== "boolean") {
        throw new Error(
          `tools[${index}](${tool.name.trim()}).transaction.undo_safe must be boolean`
        );
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(tool, "tool_priority") &&
      !["P0", "P1", "P2"].includes(String(tool.tool_priority || "").trim().toUpperCase())
    ) {
      throw new Error(
        `tools[${index}](${tool.name.trim()}).tool_priority must be P0|P1|P2`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(tool, "must_configure") &&
      typeof tool.must_configure !== "boolean"
    ) {
      throw new Error(
        `tools[${index}](${tool.name.trim()}).must_configure must be boolean`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(tool, "priority_score") &&
      !Number.isFinite(Number(tool.priority_score))
    ) {
      throw new Error(
        `tools[${index}](${tool.name.trim()}).priority_score must be number`
      );
    }

    if (Object.prototype.hasOwnProperty.call(tool, "related_tools")) {
      assertStringArray(
        tool.related_tools,
        `tools[${index}](${tool.name.trim()}).related_tools`
      );
      const related = tool.related_tools.map((item) => item.trim());
      for (const relatedTool of related) {
        if (relatedTool === tool.name.trim()) {
          throw new Error(
            `tools[${index}](${tool.name.trim()}).related_tools cannot include self`
          );
        }
        if (!toolNameSet.has(relatedTool)) {
          throw new Error(
            `tools[${index}](${tool.name.trim()}).related_tools contains unknown tool '${relatedTool}'`
          );
        }
      }
      relatedGraph.set(tool.name.trim(), related);
    } else {
      relatedGraph.set(tool.name.trim(), []);
    }

    if (Object.prototype.hasOwnProperty.call(tool, "tool_combinations")) {
      validateToolCombinations(
        tool.tool_combinations,
        `tools[${index}](${tool.name.trim()}).tool_combinations`,
        toolNameSet
      );
    }
    if (Object.prototype.hasOwnProperty.call(tool, "property_path_rules")) {
      validatePropertyPathRules(
        tool.property_path_rules,
        `tools[${index}](${tool.name.trim()}).property_path_rules`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(tool, "high_frequency_properties") &&
      !isPlainObject(tool.high_frequency_properties)
    ) {
      throw new Error(
        `tools[${index}](${tool.name.trim()}).high_frequency_properties must be an object`
      );
    }

    if (tool.must_configure === true) {
      assertNonEmptyString(
        tool.usage_notes,
        `tools[${index}](${tool.name.trim()}).usage_notes`
      );
      validateExamplesPositive(
        tool.examples_positive,
        `tools[${index}](${tool.name.trim()}).examples_positive`
      );
      validateExamplesNegative(
        tool.examples_negative,
        `tools[${index}](${tool.name.trim()}).examples_negative`
      );
      validateCommonErrorFixes(
        tool.common_error_fixes,
        `tools[${index}](${tool.name.trim()}).common_error_fixes`,
        toolNameSet
      );
      if (!Array.isArray(tool.related_tools) || tool.related_tools.length <= 0) {
        throw new Error(
          `tools[${index}](${tool.name.trim()}).related_tools must be non-empty when must_configure=true`
        );
      }
    }
  }

  detectRelatedToolCycles(relatedGraph);
  return true;
}

module.exports = {
  validateDictionaryShape,
};
