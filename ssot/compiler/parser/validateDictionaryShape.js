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

function validateTokenAutomationContract(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }

  assertEnum(
    value.issuance_authority,
    ["l2_sidecar"],
    `${label}.issuance_authority`
  );

  assertStringArray(value.token_families, `${label}.token_families`);
  const familySet = new Set(value.token_families.map((item) => String(item).trim()));
  for (const requiredFamily of [
    "read_issues_token",
    "write_requires_token",
    "local_static_no_token",
  ]) {
    if (!familySet.has(requiredFamily)) {
      throw new Error(`${label}.token_families must include '${requiredFamily}'`);
    }
  }

  assertStringArray(value.success_continuation, `${label}.success_continuation`);
  const continuationSet = new Set(
    value.success_continuation.map((item) => String(item).trim())
  );
  for (const continuationToken of continuationSet) {
    if (continuationToken !== "read" && continuationToken !== "write") {
      throw new Error(
        `${label}.success_continuation entries must be read|write`
      );
    }
  }
  for (const requiredContinuation of ["read", "write"]) {
    if (!continuationSet.has(requiredContinuation)) {
      throw new Error(
        `${label}.success_continuation must include '${requiredContinuation}'`
      );
    }
  }

  const driftRecovery = value.drift_recovery;
  if (!isPlainObject(driftRecovery)) {
    throw new Error(`${label}.drift_recovery must be an object`);
  }
  assertBoolean(driftRecovery.enabled, `${label}.drift_recovery.enabled`);
  assertNonEmptyString(
    driftRecovery.error_code,
    `${label}.drift_recovery.error_code`
  );
  assertPositiveInteger(
    driftRecovery.max_retry,
    `${label}.drift_recovery.max_retry`
  );
  if (Math.floor(Number(driftRecovery.max_retry)) !== 1) {
    throw new Error(`${label}.drift_recovery.max_retry must be 1`);
  }
  assertBoolean(
    driftRecovery.requires_idempotency,
    `${label}.drift_recovery.requires_idempotency`
  );
  if (driftRecovery.requires_idempotency !== true) {
    throw new Error(
      `${label}.drift_recovery.requires_idempotency must be true`
    );
  }
  assertNonEmptyString(
    driftRecovery.refresh_tool_name,
    `${label}.drift_recovery.refresh_tool_name`
  );

  const redactionPolicy = value.redaction_policy;
  if (!isPlainObject(redactionPolicy)) {
    throw new Error(`${label}.redaction_policy must be an object`);
  }
  assertStringArray(redactionPolicy.strip_fields, `${label}.redaction_policy.strip_fields`);
  const stripFieldSet = new Set(
    redactionPolicy.strip_fields.map((item) => String(item).trim())
  );
  for (const requiredField of [
    "read_token",
    "read_token_candidate",
    "read_token_candidate_legacy",
  ]) {
    if (!stripFieldSet.has(requiredField)) {
      throw new Error(
        `${label}.redaction_policy.strip_fields must include '${requiredField}'`
      );
    }
  }

  const autoRetryPolicy = value.auto_retry_policy;
  if (!isPlainObject(autoRetryPolicy)) {
    throw new Error(`${label}.auto_retry_policy must be an object`);
  }
  assertPositiveInteger(
    autoRetryPolicy.max_retry,
    `${label}.auto_retry_policy.max_retry`
  );
  if (Math.floor(Number(autoRetryPolicy.max_retry)) !== 1) {
    throw new Error(`${label}.auto_retry_policy.max_retry must be 1`);
  }
  assertBoolean(
    autoRetryPolicy.requires_idempotency_key,
    `${label}.auto_retry_policy.requires_idempotency_key`
  );
  if (autoRetryPolicy.requires_idempotency_key !== true) {
    throw new Error(
      `${label}.auto_retry_policy.requires_idempotency_key must be true`
    );
  }
  assertEnum(
    autoRetryPolicy.on_retry_failure,
    ["return_both_errors"],
    `${label}.auto_retry_policy.on_retry_failure`
  );

  assertStringArray(
    value.auto_retry_safe_family,
    `${label}.auto_retry_safe_family`
  );
  for (const family of value.auto_retry_safe_family) {
    if (!familySet.has(family)) {
      throw new Error(
        `${label}.auto_retry_safe_family contains unknown family '${family}'`
      );
    }
    if (family === "local_static_no_token") {
      throw new Error(
        `${label}.auto_retry_safe_family cannot include 'local_static_no_token'`
      );
    }
  }
}

function hasInputBasedOnReadTokenDeclaration(inputSchema) {
  const input =
    inputSchema &&
    typeof inputSchema === "object" &&
    !Array.isArray(inputSchema)
      ? inputSchema
      : {};
  const required = Array.isArray(input.required) ? input.required : [];
  const properties =
    input.properties && typeof input.properties === "object" && !Array.isArray(input.properties)
      ? input.properties
      : {};
  return (
    required.includes("based_on_read_token") &&
    Object.prototype.hasOwnProperty.call(properties, "based_on_read_token")
  );
}

function toolDeclaresBasedOnReadToken(tool, definitions) {
  if (hasInputBasedOnReadTokenDeclaration(tool && tool.input)) {
    return true;
  }
  const mixins = Array.isArray(tool && tool.mixins) ? tool.mixins : [];
  if (!mixins.includes("write_envelope")) {
    return false;
  }
  const writeEnvelope =
    definitions &&
    definitions.mixins &&
    definitions.mixins.write_envelope &&
    typeof definitions.mixins.write_envelope === "object"
      ? definitions.mixins.write_envelope
      : null;
  return hasInputBasedOnReadTokenDeclaration(writeEnvelope && writeEnvelope.input);
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
  validateTokenAutomationContract(
    definitions.token_automation_contract,
    "_definitions.token_automation_contract"
  );
  if (Object.prototype.hasOwnProperty.call(definitions, "planner_orchestration_contract")) {
    validatePlannerOrchestrationContract(
      definitions.planner_orchestration_contract,
      "_definitions.planner_orchestration_contract"
    );
  }
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

function validateTransactionCandidateRule(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertNonEmptyString(value.rule_id, `${label}.rule_id`);
  assertBoolean(value.enabled, `${label}.enabled`);
  assertPositiveInteger(value.priority, `${label}.priority`);
  if (!isPlainObject(value.allow_when)) {
    throw new Error(`${label}.allow_when must be an object`);
  }
  if (!isPlainObject(value.deny_when)) {
    throw new Error(`${label}.deny_when must be an object`);
  }
  assertNonEmptyString(
    value.reason_code_on_allow,
    `${label}.reason_code_on_allow`
  );
  assertNonEmptyString(
    value.reason_code_on_deny,
    `${label}.reason_code_on_deny`
  );

  if (Object.prototype.hasOwnProperty.call(value.allow_when, "write_block_count")) {
    const writeBlockCount = value.allow_when.write_block_count;
    if (!isPlainObject(writeBlockCount)) {
      throw new Error(`${label}.allow_when.write_block_count must be an object`);
    }
    assertPositiveInteger(
      writeBlockCount.min,
      `${label}.allow_when.write_block_count.min`
    );
    assertPositiveInteger(
      writeBlockCount.max,
      `${label}.allow_when.write_block_count.max`
    );
    if (Math.floor(Number(writeBlockCount.min)) > Math.floor(Number(writeBlockCount.max))) {
      throw new Error(`${label}.allow_when.write_block_count.min must be <= max`);
    }
  }
}

function validateWorkflowCandidateSignalArray(
  value,
  label,
  allowedSignalSet,
  { requiredNonEmpty = false } = {}
) {
  assertStringArray(value, label);
  if (requiredNonEmpty && value.length <= 0) {
    throw new Error(`${label} must be non-empty`);
  }
  for (const [index, rawSignal] of value.entries()) {
    const signal = String(rawSignal || "").trim();
    if (!allowedSignalSet.has(signal)) {
      throw new Error(
        `${label}[${index}] must be one of: ${Array.from(allowedSignalSet).join("|")}`
      );
    }
  }
}

function validateAllowedStringArray(
  value,
  label,
  allowedValueSet,
  { requiredNonEmpty = false } = {}
) {
  assertStringArray(value, label);
  if (requiredNonEmpty && value.length <= 0) {
    throw new Error(`${label} must be non-empty`);
  }
  for (const [index, rawValue] of value.entries()) {
    const token = String(rawValue || "").trim();
    if (!allowedValueSet.has(token)) {
      throw new Error(
        `${label}[${index}] must be one of: ${Array.from(allowedValueSet).join("|")}`
      );
    }
  }
}

const WORKFLOW_ORCHESTRATION_SCENE_SIGNALS = new Set([
  "script_file_action",
  "component_attach",
  "compile_wait_intent",
  "target_anchor_available",
  "thread_id_available",
  "target_anchor_missing",
  "thread_id_missing",
  "required_capability_missing",
  "workflow_template_disabled",
]);

const WORKFLOW_GATING_MISROUTE_PATTERNS = new Set([
  "async_ops_submit_task_mixed_slots",
  "unsupported_intent_key",
  "disabled_family_key",
  "missing_write_envelope_or_anchor",
  "generic_property_fallback_drift",
]);

const WORKFLOW_MISROUTE_RECOVERY_ERROR_CODES = new Set([
  "E_SCHEMA_INVALID",
  "E_BLOCK_INTENT_KEY_UNSUPPORTED",
  "E_COMPONENT_TYPE_INVALID",
  "E_BLOCK_NOT_IMPLEMENTED",
  "E_PLANNER_NO_TOOL_MAPPING",
  "E_PLANNER_UNSUPPORTED_FAMILY",
  "E_WORKFLOW_GATING_REJECTED",
]);

function validateWorkflowCandidateRule(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const allowedKeys = new Set([
    "rule_id",
    "enabled",
    "priority",
    "template_ref",
    "match_when",
    "deny_when",
    "reason_code_on_hit",
    "reason_code_on_deny",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `${label}.${key} is not allowed (allowed: rule_id, enabled, priority, template_ref, match_when, deny_when, reason_code_on_hit, reason_code_on_deny)`
      );
    }
  }
  assertNonEmptyString(value.rule_id, `${label}.rule_id`);
  assertBoolean(value.enabled, `${label}.enabled`);
  assertPositiveInteger(value.priority, `${label}.priority`);
  assertNonEmptyString(value.template_ref, `${label}.template_ref`);
  assertNonEmptyString(value.reason_code_on_hit, `${label}.reason_code_on_hit`);
  assertNonEmptyString(value.reason_code_on_deny, `${label}.reason_code_on_deny`);

  if (!isPlainObject(value.match_when)) {
    throw new Error(`${label}.match_when must be an object`);
  }
  const allowedMatchKeys = new Set(["all_signals", "any_signals"]);
  for (const key of Object.keys(value.match_when)) {
    if (!allowedMatchKeys.has(key)) {
      throw new Error(
        `${label}.match_when.${key} is not allowed (allowed: all_signals, any_signals)`
      );
    }
  }
  const allowedMatchSignals = new Set([
    "script_file_action",
    "component_attach",
    "compile_wait_intent",
    "target_anchor_available",
    "thread_id_available",
  ]);
  validateWorkflowCandidateSignalArray(
    value.match_when.all_signals,
    `${label}.match_when.all_signals`,
    allowedMatchSignals,
    { requiredNonEmpty: true }
  );
  if (Object.prototype.hasOwnProperty.call(value.match_when, "any_signals")) {
    validateWorkflowCandidateSignalArray(
      value.match_when.any_signals,
      `${label}.match_when.any_signals`,
      allowedMatchSignals
    );
  }

  if (!isPlainObject(value.deny_when)) {
    throw new Error(`${label}.deny_when must be an object`);
  }
  const allowedDenyKeys = new Set(["any_signals"]);
  for (const key of Object.keys(value.deny_when)) {
    if (!allowedDenyKeys.has(key)) {
      throw new Error(
        `${label}.deny_when.${key} is not allowed (allowed: any_signals)`
      );
    }
  }
  const allowedDenySignals = new Set([
    "target_anchor_missing",
    "thread_id_missing",
    "required_capability_missing",
    "workflow_template_disabled",
  ]);
  validateWorkflowCandidateSignalArray(
    value.deny_when.any_signals,
    `${label}.deny_when.any_signals`,
    allowedDenySignals,
    { requiredNonEmpty: true }
  );
}

function validateWorkflowIntentGatingRule(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const allowedKeys = new Set([
    "rule_id",
    "enabled",
    "priority",
    "action",
    "when",
    "reason_code",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `${label}.${key} is not allowed (allowed: rule_id, enabled, priority, action, when, reason_code)`
      );
    }
  }
  assertNonEmptyString(value.rule_id, `${label}.rule_id`);
  assertBoolean(value.enabled, `${label}.enabled`);
  assertPositiveInteger(value.priority, `${label}.priority`);
  assertEnum(value.action, ["allow", "warn", "reject"], `${label}.action`);
  assertNonEmptyString(value.reason_code, `${label}.reason_code`);

  if (!isPlainObject(value.when)) {
    throw new Error(`${label}.when must be an object`);
  }
  const when = value.when;
  const allowedWhenKeys = new Set([
    "candidate_hit",
    "candidate_rule_ids",
    "candidate_confidence_in",
    "required_scene_signals_all",
    "intent_key_prefixes",
    "misroute_patterns_any",
  ]);
  for (const key of Object.keys(when)) {
    if (!allowedWhenKeys.has(key)) {
      throw new Error(
        `${label}.when.${key} is not allowed (allowed: candidate_hit, candidate_rule_ids, candidate_confidence_in, required_scene_signals_all, intent_key_prefixes, misroute_patterns_any)`
      );
    }
  }
  if (Object.keys(when).length <= 0) {
    throw new Error(`${label}.when must include at least one condition`);
  }

  if (Object.prototype.hasOwnProperty.call(when, "candidate_hit")) {
    assertBoolean(when.candidate_hit, `${label}.when.candidate_hit`);
  }
  if (Object.prototype.hasOwnProperty.call(when, "candidate_rule_ids")) {
    assertStringArray(when.candidate_rule_ids, `${label}.when.candidate_rule_ids`);
    if (when.candidate_rule_ids.length <= 0) {
      throw new Error(`${label}.when.candidate_rule_ids must be non-empty`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(when, "candidate_confidence_in")) {
    validateAllowedStringArray(
      when.candidate_confidence_in,
      `${label}.when.candidate_confidence_in`,
      new Set(["none", "medium", "high"]),
      { requiredNonEmpty: true }
    );
  }
  if (Object.prototype.hasOwnProperty.call(when, "required_scene_signals_all")) {
    validateWorkflowCandidateSignalArray(
      when.required_scene_signals_all,
      `${label}.when.required_scene_signals_all`,
      WORKFLOW_ORCHESTRATION_SCENE_SIGNALS,
      { requiredNonEmpty: true }
    );
  }
  if (Object.prototype.hasOwnProperty.call(when, "intent_key_prefixes")) {
    assertStringArray(when.intent_key_prefixes, `${label}.when.intent_key_prefixes`);
    if (when.intent_key_prefixes.length <= 0) {
      throw new Error(`${label}.when.intent_key_prefixes must be non-empty`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(when, "misroute_patterns_any")) {
    validateAllowedStringArray(
      when.misroute_patterns_any,
      `${label}.when.misroute_patterns_any`,
      WORKFLOW_GATING_MISROUTE_PATTERNS,
      { requiredNonEmpty: true }
    );
  }

  if (value.action === "reject") {
    if (when.candidate_hit !== true) {
      throw new Error(`${label} reject requires when.candidate_hit=true`);
    }
    const confidenceIn = Array.isArray(when.candidate_confidence_in)
      ? when.candidate_confidence_in.map((item) => String(item || "").trim())
      : [];
    if (confidenceIn.length !== 1 || confidenceIn[0] !== "high") {
      throw new Error(
        `${label} reject requires when.candidate_confidence_in to be exactly [high]`
      );
    }
    if (!Array.isArray(when.misroute_patterns_any) || when.misroute_patterns_any.length <= 0) {
      throw new Error(`${label} reject requires non-empty when.misroute_patterns_any`);
    }
  }
}

function validateWorkflowMisrouteRecoveryRule(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const allowedKeys = new Set([
    "rule_id",
    "enabled",
    "priority",
    "template_ref",
    "when",
    "reason_code",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `${label}.${key} is not allowed (allowed: rule_id, enabled, priority, template_ref, when, reason_code)`
      );
    }
  }
  assertNonEmptyString(value.rule_id, `${label}.rule_id`);
  assertBoolean(value.enabled, `${label}.enabled`);
  assertPositiveInteger(value.priority, `${label}.priority`);
  assertNonEmptyString(value.template_ref, `${label}.template_ref`);
  assertNonEmptyString(value.reason_code, `${label}.reason_code`);

  if (!isPlainObject(value.when)) {
    throw new Error(`${label}.when must be an object`);
  }
  const when = value.when;
  const allowedWhenKeys = new Set([
    "candidate_hit",
    "candidate_rule_ids",
    "required_scene_signals_all",
    "failure_path_error_codes_any",
  ]);
  for (const key of Object.keys(when)) {
    if (!allowedWhenKeys.has(key)) {
      throw new Error(
        `${label}.when.${key} is not allowed (allowed: candidate_hit, candidate_rule_ids, required_scene_signals_all, failure_path_error_codes_any)`
      );
    }
  }
  if (Object.keys(when).length <= 0) {
    throw new Error(`${label}.when must include at least one condition`);
  }

  if (Object.prototype.hasOwnProperty.call(when, "candidate_hit")) {
    assertBoolean(when.candidate_hit, `${label}.when.candidate_hit`);
  }
  if (Object.prototype.hasOwnProperty.call(when, "candidate_rule_ids")) {
    assertStringArray(when.candidate_rule_ids, `${label}.when.candidate_rule_ids`);
    if (when.candidate_rule_ids.length <= 0) {
      throw new Error(`${label}.when.candidate_rule_ids must be non-empty`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(when, "required_scene_signals_all")) {
    validateWorkflowCandidateSignalArray(
      when.required_scene_signals_all,
      `${label}.when.required_scene_signals_all`,
      WORKFLOW_ORCHESTRATION_SCENE_SIGNALS,
      { requiredNonEmpty: true }
    );
  }
  if (Object.prototype.hasOwnProperty.call(when, "failure_path_error_codes_any")) {
    validateAllowedStringArray(
      when.failure_path_error_codes_any,
      `${label}.when.failure_path_error_codes_any`,
      WORKFLOW_MISROUTE_RECOVERY_ERROR_CODES,
      { requiredNonEmpty: true }
    );
  }

  if (when.candidate_hit !== true) {
    throw new Error(`${label} requires when.candidate_hit=true`);
  }
  if (
    !Array.isArray(when.required_scene_signals_all) ||
    when.required_scene_signals_all.length <= 0
  ) {
    throw new Error(`${label} requires non-empty when.required_scene_signals_all`);
  }
  if (
    !Array.isArray(when.failure_path_error_codes_any) ||
    when.failure_path_error_codes_any.length <= 0
  ) {
    throw new Error(`${label} requires non-empty when.failure_path_error_codes_any`);
  }
}

function validateWorkflowTemplateStep(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertNonEmptyString(value.step_id, `${label}.step_id`);
  assertEnum(
    value.step_type,
    ["submit_task", "wait_task_status", "ensure_target"],
    `${label}.step_type`
  );
  assertNonEmptyString(value.tool_name, `${label}.tool_name`);

  if (value.step_type === "submit_task") {
    const allowedSubmitStepKeys = new Set([
      "step_id",
      "step_type",
      "tool_name",
      "task_payload_slot",
    ]);
    for (const key of Object.keys(value)) {
      if (!allowedSubmitStepKeys.has(key)) {
        throw new Error(
          `${label}.${key} is not allowed (allowed: step_id, step_type, tool_name, task_payload_slot)`
        );
      }
    }
    assertEnum(
      value.task_payload_slot,
      ["file_actions", "visual_layer_actions"],
      `${label}.task_payload_slot`
    );
    return;
  }

  if (value.step_type === "wait_task_status") {
    const allowedWaitStepKeys = new Set([
      "step_id",
      "step_type",
      "tool_name",
      "poll_interval_ms",
      "timeout_ms",
      "success_statuses",
      "failure_statuses",
    ]);
    for (const key of Object.keys(value)) {
      if (!allowedWaitStepKeys.has(key)) {
        throw new Error(
          `${label}.${key} is not allowed (allowed: step_id, step_type, tool_name, poll_interval_ms, timeout_ms, success_statuses, failure_statuses)`
        );
      }
    }
    assertPositiveInteger(value.poll_interval_ms, `${label}.poll_interval_ms`);
    assertPositiveInteger(value.timeout_ms, `${label}.timeout_ms`);
    assertStringArray(value.success_statuses, `${label}.success_statuses`);
    assertStringArray(value.failure_statuses, `${label}.failure_statuses`);
    if (value.success_statuses.length <= 0) {
      throw new Error(`${label}.success_statuses must be non-empty`);
    }
    if (value.failure_statuses.length <= 0) {
      throw new Error(`${label}.failure_statuses must be non-empty`);
    }
    return;
  }

  const allowedEnsureTargetStepKeys = new Set([
    "step_id",
    "step_type",
    "tool_name",
    "ensure_target_contract",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedEnsureTargetStepKeys.has(key)) {
      throw new Error(
        `${label}.${key} is not allowed (allowed: step_id, step_type, tool_name, ensure_target_contract)`
      );
    }
  }
  assertEnum(
    value.tool_name,
    ["create_object", "create.object"],
    `${label}.tool_name`
  );

  const contract = value.ensure_target_contract;
  if (!isPlainObject(contract)) {
    throw new Error(`${label}.ensure_target_contract must be an object`);
  }
  const allowedContractKeys = new Set([
    "parent_anchor_input_field",
    "resolved_target_output_field",
    "collision_policy_input_field",
    "allowed_collision_policies",
    "default_collision_policy",
    "require_unique_reuse_match",
    "forbid_fuzzy_reuse",
  ]);
  for (const key of Object.keys(contract)) {
    if (!allowedContractKeys.has(key)) {
      throw new Error(
        `${label}.ensure_target_contract.${key} is not allowed (allowed: parent_anchor_input_field, resolved_target_output_field, collision_policy_input_field, allowed_collision_policies, default_collision_policy, require_unique_reuse_match, forbid_fuzzy_reuse)`
      );
    }
  }
  assertNonEmptyString(
    contract.parent_anchor_input_field,
    `${label}.ensure_target_contract.parent_anchor_input_field`
  );
  assertNonEmptyString(
    contract.resolved_target_output_field,
    `${label}.ensure_target_contract.resolved_target_output_field`
  );
  assertNonEmptyString(
    contract.collision_policy_input_field,
    `${label}.ensure_target_contract.collision_policy_input_field`
  );
  const parentAnchorInputField = String(contract.parent_anchor_input_field).trim();
  const resolvedTargetOutputField = String(contract.resolved_target_output_field).trim();
  const collisionPolicyInputField = String(contract.collision_policy_input_field).trim();

  if (!parentAnchorInputField.includes("parent_anchor")) {
    throw new Error(
      `${label}.ensure_target_contract.parent_anchor_input_field must encode parent_anchor semantics`
    );
  }
  if (!resolvedTargetOutputField.includes("resolved_target")) {
    throw new Error(
      `${label}.ensure_target_contract.resolved_target_output_field must encode resolved_target semantics`
    );
  }
  if (!collisionPolicyInputField.includes("name_collision_policy")) {
    throw new Error(
      `${label}.ensure_target_contract.collision_policy_input_field must point to name_collision_policy`
    );
  }
  if (parentAnchorInputField === resolvedTargetOutputField) {
    throw new Error(
      `${label}.ensure_target_contract.parent_anchor_input_field must differ from resolved_target_output_field`
    );
  }
  validateAllowedStringArray(
    contract.allowed_collision_policies,
    `${label}.ensure_target_contract.allowed_collision_policies`,
    new Set(["fail", "reuse"]),
    { requiredNonEmpty: true }
  );
  assertNonEmptyString(
    contract.default_collision_policy,
    `${label}.ensure_target_contract.default_collision_policy`
  );
  if (!contract.allowed_collision_policies.includes(contract.default_collision_policy)) {
    throw new Error(
      `${label}.ensure_target_contract.default_collision_policy must be included in allowed_collision_policies`
    );
  }
  assertBoolean(
    contract.require_unique_reuse_match,
    `${label}.ensure_target_contract.require_unique_reuse_match`
  );
  if (contract.require_unique_reuse_match !== true) {
    throw new Error(
      `${label}.ensure_target_contract.require_unique_reuse_match must be true in phase1`
    );
  }
  assertBoolean(
    contract.forbid_fuzzy_reuse,
    `${label}.ensure_target_contract.forbid_fuzzy_reuse`
  );
  if (contract.forbid_fuzzy_reuse !== true) {
    throw new Error(
      `${label}.ensure_target_contract.forbid_fuzzy_reuse must be true in phase1`
    );
  }
}

function validateWorkflowTemplate(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertBoolean(value.enabled, `${label}.enabled`);
  assertEnum(
    value.workflow_type,
    ["condition_wait_sequential"],
    `${label}.workflow_type`
  );
  if (!isPlainObject(value.selection)) {
    throw new Error(`${label}.selection must be an object`);
  }
  assertStringArray(value.selection.intent_keys, `${label}.selection.intent_keys`);
  if (value.selection.intent_keys.length <= 0) {
    throw new Error(`${label}.selection.intent_keys must be non-empty`);
  }
  assertStringArray(
    value.selection.required_capabilities,
    `${label}.selection.required_capabilities`
  );
  if (value.selection.required_capabilities.length <= 0) {
    throw new Error(`${label}.selection.required_capabilities must be non-empty`);
  }
  if (!Array.isArray(value.steps) || value.steps.length <= 0) {
    throw new Error(`${label}.steps must be a non-empty array`);
  }
  for (const [index, step] of value.steps.entries()) {
    validateWorkflowTemplateStep(step, `${label}.steps[${index}]`);
  }
  if (!isPlainObject(value.error_mapping)) {
    throw new Error(`${label}.error_mapping must be an object`);
  }
  const errorEntries = Object.entries(value.error_mapping);
  if (errorEntries.length <= 0) {
    throw new Error(`${label}.error_mapping must be non-empty`);
  }
  for (const [errorKey, errorCode] of errorEntries) {
    assertNonEmptyString(errorKey, `${label}.error_mapping.<error_key>`);
    assertNonEmptyString(errorCode, `${label}.error_mapping.${errorKey}`);
  }
}

function validateReadWriteFoldingProfile(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const allowedKeys = new Set([
    "enabled",
    "rollout_stage",
    "selection",
    "trace_contract",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `${label}.${key} is not allowed (allowed: enabled, rollout_stage, selection, trace_contract)`
      );
    }
  }
  assertBoolean(value.enabled, `${label}.enabled`);
  assertEnum(value.rollout_stage, ["pilot"], `${label}.rollout_stage`);

  const selection = value.selection;
  if (!isPlainObject(selection)) {
    throw new Error(`${label}.selection must be an object`);
  }
  const allowedSelectionKeys = new Set([
    "read_intent_keys",
    "mutate_intent_keys",
    "same_target_anchor",
    "max_block_span",
  ]);
  for (const key of Object.keys(selection)) {
    if (!allowedSelectionKeys.has(key)) {
      throw new Error(
        `${label}.selection.${key} is not allowed (allowed: read_intent_keys, mutate_intent_keys, same_target_anchor, max_block_span)`
      );
    }
  }
  assertStringArray(selection.read_intent_keys, `${label}.selection.read_intent_keys`);
  if (selection.read_intent_keys.length <= 0) {
    throw new Error(`${label}.selection.read_intent_keys must be non-empty`);
  }
  assertStringArray(
    selection.mutate_intent_keys,
    `${label}.selection.mutate_intent_keys`
  );
  if (selection.mutate_intent_keys.length <= 0) {
    throw new Error(`${label}.selection.mutate_intent_keys must be non-empty`);
  }
  assertBoolean(selection.same_target_anchor, `${label}.selection.same_target_anchor`);
  assertPositiveInteger(selection.max_block_span, `${label}.selection.max_block_span`);

  const traceContract = value.trace_contract;
  if (!isPlainObject(traceContract)) {
    throw new Error(`${label}.trace_contract must be an object`);
  }
  const allowedTraceKeys = new Set(["required_fields"]);
  for (const key of Object.keys(traceContract)) {
    if (!allowedTraceKeys.has(key)) {
      throw new Error(
        `${label}.trace_contract.${key} is not allowed (allowed: required_fields)`
      );
    }
  }
  assertStringArray(traceContract.required_fields, `${label}.trace_contract.required_fields`);
  if (traceContract.required_fields.length <= 0) {
    throw new Error(`${label}.trace_contract.required_fields must be non-empty`);
  }
  const requiredFieldSet = new Set(
    traceContract.required_fields.map((item) => String(item).trim())
  );
  for (const requiredField of [
    "raw_read_block_id",
    "raw_mutate_block_id",
    "folding_rule_id",
    "read_value_summary",
    "computed_write_value_summary",
    "token_source",
    "synthesized_request_summary",
  ]) {
    if (!requiredFieldSet.has(requiredField)) {
      throw new Error(
        `${label}.trace_contract.required_fields must include '${requiredField}'`
      );
    }
  }
}

function validatePlannerOrchestrationContract(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const allowedKeys = new Set([
    "schema_version",
    "transaction_candidate_rules",
    "workflow_candidate_rules",
    "workflow_intent_gating_rules",
    "workflow_misroute_recovery_rules",
    "workflow_templates",
    "read_write_folding_profiles",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `${label}.${key} is not allowed (allowed: schema_version, transaction_candidate_rules, workflow_candidate_rules, workflow_intent_gating_rules, workflow_misroute_recovery_rules, workflow_templates, read_write_folding_profiles)`
      );
    }
  }
  assertNonEmptyString(value.schema_version, `${label}.schema_version`);
  if (
    !Array.isArray(value.transaction_candidate_rules) ||
    value.transaction_candidate_rules.length <= 0
  ) {
    throw new Error(`${label}.transaction_candidate_rules must be a non-empty array`);
  }
  for (const [index, rule] of value.transaction_candidate_rules.entries()) {
    validateTransactionCandidateRule(
      rule,
      `${label}.transaction_candidate_rules[${index}]`
    );
  }
  if (Object.prototype.hasOwnProperty.call(value, "workflow_candidate_rules")) {
    if (
      !Array.isArray(value.workflow_candidate_rules) ||
      value.workflow_candidate_rules.length <= 0
    ) {
      throw new Error(`${label}.workflow_candidate_rules must be a non-empty array`);
    }
    for (const [index, rule] of value.workflow_candidate_rules.entries()) {
      validateWorkflowCandidateRule(
        rule,
        `${label}.workflow_candidate_rules[${index}]`
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "workflow_intent_gating_rules")) {
    if (
      !Array.isArray(value.workflow_intent_gating_rules) ||
      value.workflow_intent_gating_rules.length <= 0
    ) {
      throw new Error(
        `${label}.workflow_intent_gating_rules must be a non-empty array`
      );
    }
    for (const [index, rule] of value.workflow_intent_gating_rules.entries()) {
      validateWorkflowIntentGatingRule(
        rule,
        `${label}.workflow_intent_gating_rules[${index}]`
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "workflow_templates")) {
    if (!isPlainObject(value.workflow_templates)) {
      throw new Error(`${label}.workflow_templates must be an object`);
    }
    for (const [templateName, templateDef] of Object.entries(
      value.workflow_templates
    )) {
      assertNonEmptyString(
        templateName,
        `${label}.workflow_templates.<template_name>`
      );
      validateWorkflowTemplate(
        templateDef,
        `${label}.workflow_templates.${templateName}`
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "workflow_misroute_recovery_rules")) {
    if (
      !Array.isArray(value.workflow_misroute_recovery_rules) ||
      value.workflow_misroute_recovery_rules.length <= 0
    ) {
      throw new Error(
        `${label}.workflow_misroute_recovery_rules must be a non-empty array`
      );
    }
    for (const [index, rule] of value.workflow_misroute_recovery_rules.entries()) {
      validateWorkflowMisrouteRecoveryRule(
        rule,
        `${label}.workflow_misroute_recovery_rules[${index}]`
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "read_write_folding_profiles")) {
    if (!isPlainObject(value.read_write_folding_profiles)) {
      throw new Error(`${label}.read_write_folding_profiles must be an object`);
    }
    for (const [profileId, profileDef] of Object.entries(
      value.read_write_folding_profiles
    )) {
      assertNonEmptyString(
        profileId,
        `${label}.read_write_folding_profiles.<profile_id>`
      );
      validateReadWriteFoldingProfile(
        profileDef,
        `${label}.read_write_folding_profiles.${profileId}`
      );
    }
  }
}

function validateUxContractAutofillPolicyEntry(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertNonEmptyString(value.field, `${label}.field`);
  assertEnum(
    value.strategy,
    [
      "default_if_missing",
      "generate_if_missing",
      "copy_if_missing",
      "copy_from_context_if_missing",
    ],
    `${label}.strategy`
  );
  if (value.strategy === "default_if_missing") {
    if (!Object.prototype.hasOwnProperty.call(value, "value")) {
      throw new Error(`${label}.value is required for default_if_missing`);
    }
  }
  if (value.strategy === "copy_if_missing") {
    assertNonEmptyString(value.source_field, `${label}.source_field`);
  }
  if (value.strategy === "copy_from_context_if_missing") {
    assertStringArray(value.context_priority, `${label}.context_priority`);
    if (value.context_priority.length <= 0) {
      throw new Error(
        `${label}.context_priority must be non-empty for copy_from_context_if_missing`
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "conditions")) {
    if (!isPlainObject(value.conditions)) {
      throw new Error(`${label}.conditions must be an object`);
    }
    if (Object.prototype.hasOwnProperty.call(value.conditions, "block_type_in")) {
      assertStringArray(value.conditions.block_type_in, `${label}.conditions.block_type_in`);
      if (value.conditions.block_type_in.length <= 0) {
        throw new Error(`${label}.conditions.block_type_in must be non-empty`);
      }
    }
  }
}

function validateUxContract(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertNonEmptyString(value.domain, `${label}.domain`);
  assertStringArray(value.block_type_enum, `${label}.block_type_enum`);
  if (value.block_type_enum.length <= 0) {
    throw new Error(`${label}.block_type_enum must be non-empty`);
  }
  assertStringArray(
    value.required_business_fields,
    `${label}.required_business_fields`
  );
  assertStringArray(value.system_fields, `${label}.system_fields`);
  assertStringArray(value.auto_filled_fields, `${label}.auto_filled_fields`);
  if (
    !Object.prototype.hasOwnProperty.call(value, "minimal_valid_template") ||
    !isPlainObject(value.minimal_valid_template)
  ) {
    throw new Error(`${label}.minimal_valid_template must be an object`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "common_aliases")) {
    if (!isPlainObject(value.common_aliases)) {
      throw new Error(`${label}.common_aliases must be an object`);
    }
    for (const [canonicalField, aliases] of Object.entries(value.common_aliases)) {
      assertNonEmptyString(canonicalField, `${label}.common_aliases.<canonical_field>`);
      assertStringArray(aliases, `${label}.common_aliases.${canonicalField}`);
      if (aliases.length <= 0) {
        throw new Error(`${label}.common_aliases.${canonicalField} must be non-empty`);
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "autofill_policy")) {
    if (!isPlainObject(value.autofill_policy)) {
      throw new Error(`${label}.autofill_policy must be an object`);
    }
    for (const [policyName, policy] of Object.entries(value.autofill_policy)) {
      assertNonEmptyString(policyName, `${label}.autofill_policy.<policy_name>`);
      validateUxContractAutofillPolicyEntry(
        policy,
        `${label}.autofill_policy.${policyName}`
      );
    }
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
  const definitions = dictionary._definitions;
  const tokenAutomationContract = definitions.token_automation_contract;
  const tokenFamilySet = new Set(tokenAutomationContract.token_families);

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
    const tokenFamily =
      typeof tool.token_family === "string" ? tool.token_family.trim() : "";
    if (!tokenFamily) {
      throw new Error(
        `tools[${index}](${tool.name.trim()}).token_family must be a non-empty string`
      );
    }
    if (!tokenFamilySet.has(tokenFamily)) {
      throw new Error(
        `tools[${index}](${tool.name.trim()}).token_family '${tokenFamily}' is not in _definitions.token_automation_contract.token_families`
      );
    }
    if (typeof tool.scene_revision_capable !== "boolean") {
      throw new Error(
        `tools[${index}](${tool.name.trim()}).scene_revision_capable must be boolean`
      );
    }

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

    if (tokenFamily === "write_requires_token") {
      if (kind !== "write") {
        throw new Error(
          `tools[${index}](${tool.name.trim()}).token_family write_requires_token requires kind=write`
        );
      }
      if (!toolDeclaresBasedOnReadToken(tool, definitions)) {
        throw new Error(
          `tools[${index}](${tool.name.trim()}) write_requires_token must declare based_on_read_token (input or write_envelope mixin)`
        );
      }
      if (tool.scene_revision_capable !== true) {
        throw new Error(
          `tools[${index}](${tool.name.trim()}) write_requires_token requires scene_revision_capable=true`
        );
      }
    } else if (tokenFamily === "read_issues_token") {
      if (kind !== "read") {
        throw new Error(
          `tools[${index}](${tool.name.trim()}).token_family read_issues_token requires kind=read`
        );
      }
      if (tool.scene_revision_capable !== true) {
        throw new Error(
          `tools[${index}](${tool.name.trim()}) read_issues_token requires scene_revision_capable=true`
        );
      }
    } else if (tokenFamily === "local_static_no_token") {
      if (kind !== "read") {
        throw new Error(
          `tools[${index}](${tool.name.trim()}).token_family local_static_no_token requires kind=read`
        );
      }
      if (tool.scene_revision_capable !== false) {
        throw new Error(
          `tools[${index}](${tool.name.trim()}) local_static_no_token requires scene_revision_capable=false`
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
    if (Object.prototype.hasOwnProperty.call(tool, "ux_contract")) {
      validateUxContract(
        tool.ux_contract,
        `tools[${index}](${tool.name.trim()}).ux_contract`
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
