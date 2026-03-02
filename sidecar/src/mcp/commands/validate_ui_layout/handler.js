"use strict";

const {
  withMcpErrorFeedback,
} = require("../../../application/mcpGateway/mcpErrorFeedback");

const QUERY_TYPE = "validate_ui_layout";

async function executeValidateUiLayout(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload = normalizePayload(requestBody);
  const queryCoordinator =
    ctx.queryCoordinator && typeof ctx.queryCoordinator === "object"
      ? ctx.queryCoordinator
      : null;
  if (
    !queryCoordinator ||
    typeof queryCoordinator.enqueueAndWaitForUnityQuery !== "function"
  ) {
    return {
      statusCode: 500,
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: "E_INTERNAL",
        message: "Unity query runtime is not configured",
      }),
    };
  }

  let unityResponse = null;
  try {
    unityResponse = await queryCoordinator.enqueueAndWaitForUnityQuery({
      queryType: QUERY_TYPE,
      payload,
      timeoutMs: payload.timeout_ms,
    });
  } catch (error) {
    return mapFailure(error);
  }

  if (!unityResponse || typeof unityResponse !== "object") {
    return {
      statusCode: 502,
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: "E_UI_LAYOUT_VALIDATION_FAILED",
        message: "Unity validate_ui_layout response is invalid",
      }),
    };
  }

  if (unityResponse.ok !== true) {
    const errorCode = normalizeNonEmptyString(unityResponse.error_code);
    const errorMessage =
      normalizeNonEmptyString(unityResponse.error_message) ||
      normalizeNonEmptyString(unityResponse.message) ||
      "Unity validate_ui_layout query failed";
    return {
      statusCode: mapValidateErrorToStatusCode(errorCode),
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: errorCode || "E_UI_LAYOUT_VALIDATION_FAILED",
        message: errorMessage,
      }),
    };
  }

  const normalizedData = normalizeLayoutData(unityResponse.data, payload);
  const snapshotService =
    ctx.snapshotService && typeof ctx.snapshotService === "object"
      ? ctx.snapshotService
      : null;
  const readToken =
    snapshotService &&
    typeof snapshotService.issueReadTokenForQueryResult === "function"
      ? snapshotService.issueReadTokenForQueryResult(
          QUERY_TYPE,
          unityResponse,
          payload
        )
      : null;

  return {
    statusCode: 200,
    body: {
      ok: true,
      data: normalizedData,
      ...(readToken ? { read_token: readToken } : {}),
      captured_at:
        normalizeNonEmptyString(unityResponse.captured_at) ||
        (typeof ctx.nowIso === "function" ? ctx.nowIso() : new Date().toISOString()),
    },
  };
}

function normalizePayload(body) {
  const source = body && typeof body === "object" ? body : {};
  const payload = { ...source };
  const scope =
    payload.scope && typeof payload.scope === "object" ? payload.scope : null;
  const scopeRootPath =
    scope && typeof scope.root_path === "string" ? scope.root_path.trim() : "";
  if (scopeRootPath && !normalizeNonEmptyString(payload.root_path)) {
    payload.root_path = scopeRootPath;
  }
  payload.include_repair_plan = payload.include_repair_plan === true;
  if (payload.max_repair_suggestions !== undefined) {
    const normalizedLimit = Number(payload.max_repair_suggestions);
    payload.max_repair_suggestions =
      Number.isFinite(normalizedLimit) && normalizedLimit > 0
        ? Math.floor(normalizedLimit)
        : undefined;
  }
  const normalizedStyle = normalizeRepairStyle(payload.repair_style);
  payload.repair_style = normalizedStyle || undefined;
  return payload;
}

function normalizeLayoutData(data, payload) {
  const source = data && typeof data === "object" ? { ...data } : {};
  if (!source.scope && payload.scope && typeof payload.scope === "object") {
    source.scope = payload.scope;
  }
  if (!Array.isArray(source.resolutions) && Array.isArray(payload.resolutions)) {
    source.resolutions = payload.resolutions;
  }
  if (!Number.isFinite(Number(source.time_budget_ms)) && Number.isFinite(Number(payload.time_budget_ms))) {
    source.time_budget_ms = Math.floor(Number(payload.time_budget_ms));
  }
  source.partial = source.partial === true;
  source.truncated_reason = normalizeNonEmptyString(source.truncated_reason) || null;
  source.issues = Array.isArray(source.issues)
    ? source.issues.map((item) => normalizeIssue(item, source))
    : [];
  if (!Number.isFinite(Number(source.issue_count))) {
    source.issue_count = source.issues.length;
  } else {
    source.issue_count = Math.max(0, Math.floor(Number(source.issue_count)));
  }

  const specialistSummary = buildSpecialistSummary(source.issues);
  source.specialist_summary = {
    ...(source.specialist_summary && typeof source.specialist_summary === "object"
      ? source.specialist_summary
      : {}),
    ...specialistSummary,
  };

  if (payload && payload.include_repair_plan === true) {
    const maxSuggestions = normalizeRepairLimit(payload.max_repair_suggestions);
    const style = normalizeRepairStyle(payload.repair_style) || "balanced";
    const incomingPlan = Array.isArray(source.repair_plan)
      ? source.repair_plan.map((item) => normalizeRepairItem(item))
      : [];
    let plan = incomingPlan.filter(Boolean);
    let generatedBy = normalizeNonEmptyString(source.repair_plan_generated_by);
    if (plan.length === 0) {
      plan = buildRepairPlan(source.issues, {
        maxSuggestions,
        repairStyle: style,
      });
      generatedBy = "sidecar";
    }

    source.repair_plan = plan.slice(0, maxSuggestions);
    source.repair_plan_generated_by = generatedBy || "sidecar";
    source.specialist_summary.has_repair_plan = source.repair_plan.length > 0;
    source.specialist_summary.repair_style = style;
  } else {
    delete source.repair_plan;
    delete source.repair_plan_generated_by;
    source.specialist_summary.has_repair_plan = false;
    source.specialist_summary.repair_style = "";
  }

  return source;
}

function normalizeIssue(issue, layoutData) {
  const item = issue && typeof issue === "object" ? { ...issue } : {};
  const issueType = normalizeNonEmptyString(item.issue_type);
  const approximate =
    item.approximate === true ||
    normalizeNonEmptyString(item.approx_reason) === "NO_RAYCAST_SOURCE";
  if (issueType === "NOT_CLICKABLE") {
    if (!normalizeNonEmptyString(item.mode)) {
      item.mode = approximate
        ? "static_only"
        : "theoretical_with_raycast_context";
    }
    if (approximate && !normalizeNonEmptyString(item.severity)) {
      item.severity = "warning";
    }
  } else if (issueType === "TEXT_OVERFLOW") {
    if (!normalizeNonEmptyString(item.mode)) {
      const runtimeName = normalizeNonEmptyString(layoutData.runtime_resolution_name);
      const resolutionName = normalizeNonEmptyString(item.resolution);
      item.mode =
        runtimeName && resolutionName && resolutionName !== runtimeName
          ? "derived_only"
          : "direct_runtime";
    }
    if (item.mode === "derived_only" && !normalizeNonEmptyString(item.severity)) {
      item.severity = "warning";
    }
  } else {
    if (!normalizeNonEmptyString(item.mode)) {
      item.mode = "direct_runtime";
    }
  }
  if (!normalizeNonEmptyString(item.confidence)) {
    item.confidence = approximate || item.mode === "derived_only" ? "low" : "high";
  }
  return item;
}

function normalizeRepairItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const targetAnchor =
    item.target_anchor && typeof item.target_anchor === "object"
      ? {
          object_id: normalizeNonEmptyString(item.target_anchor.object_id),
          path: normalizeNonEmptyString(item.target_anchor.path),
        }
      : null;

  return {
    issue_type: normalizeNonEmptyString(item.issue_type),
    target_anchor: targetAnchor,
    strategy: normalizeNonEmptyString(item.strategy),
    recommended_action_type: normalizeNonEmptyString(item.recommended_action_type),
    action_data_template_json: normalizeNonEmptyString(item.action_data_template_json),
    rationale: normalizeNonEmptyString(item.rationale),
    risk: normalizeNonEmptyString(item.risk),
  };
}

function buildSpecialistSummary(issues) {
  const list = Array.isArray(issues) ? issues : [];
  const summary = {
    out_of_bounds_count: 0,
    overlap_count: 0,
    not_clickable_count: 0,
    text_overflow_count: 0,
    high_severity_count: 0,
    low_confidence_count: 0,
  };

  for (const issue of list) {
    const type = normalizeNonEmptyString(issue && issue.issue_type);
    if (type === "OUT_OF_BOUNDS") {
      summary.out_of_bounds_count += 1;
    } else if (type === "OVERLAP") {
      summary.overlap_count += 1;
    } else if (type === "NOT_CLICKABLE") {
      summary.not_clickable_count += 1;
    } else if (type === "TEXT_OVERFLOW") {
      summary.text_overflow_count += 1;
    }

    const severity = normalizeNonEmptyString(issue && issue.severity).toLowerCase();
    if (severity === "error") {
      summary.high_severity_count += 1;
    }

    const confidence = normalizeNonEmptyString(issue && issue.confidence).toLowerCase();
    if (confidence === "low") {
      summary.low_confidence_count += 1;
    }
  }

  return summary;
}

function buildRepairPlan(issues, options) {
  const opts = options && typeof options === "object" ? options : {};
  const maxSuggestions = normalizeRepairLimit(opts.maxSuggestions);
  const repairStyle = normalizeRepairStyle(opts.repairStyle) || "balanced";
  const list = Array.isArray(issues) ? issues : [];
  const plan = [];
  for (const issue of list) {
    if (plan.length >= maxSuggestions) {
      break;
    }
    const candidate = buildRepairItem(issue, repairStyle);
    if (candidate) {
      plan.push(candidate);
    }
  }
  return plan;
}

function buildRepairItem(issue, repairStyle) {
  const item = issue && typeof issue === "object" ? issue : {};
  const issueType = normalizeNonEmptyString(item.issue_type);
  if (!issueType) {
    return null;
  }

  const targetAnchor =
    item.anchor && typeof item.anchor === "object"
      ? {
          object_id: normalizeNonEmptyString(item.anchor.object_id),
          path: normalizeNonEmptyString(item.anchor.path),
        }
      : null;
  const style = normalizeRepairStyle(repairStyle) || "balanced";
  const base = {
    issue_type: issueType,
    target_anchor: targetAnchor,
    strategy: "manual_triage",
    recommended_action_type: "set_serialized_property",
    action_data_template_json: "{}",
    rationale:
      normalizeNonEmptyString(item.suggestion) ||
      "Apply deterministic primitive fix then re-run validate_ui_layout.",
    risk: "medium",
  };

  if (issueType === "OUT_OF_BOUNDS") {
    return {
      ...base,
      strategy: "move_inside_safe_bounds",
      recommended_action_type: "set_rect_anchored_position",
      action_data_template_json: "{\"x\":0,\"y\":0}",
      rationale: "Move element into visible bounds before fine tuning offsets.",
      risk: "low",
    };
  }

  if (issueType === "OVERLAP") {
    if (style === "aggressive") {
      return {
        ...base,
        strategy: "separate_by_layout_size",
        recommended_action_type: "set_rect_size_delta",
        action_data_template_json: "{\"x\":320,\"y\":80}",
        rationale: "Expand/reshape one container to clear overlap in current layout.",
        risk: "medium",
      };
    }
    return {
      ...base,
      strategy: "separate_by_position",
      recommended_action_type: "set_rect_anchored_position",
      action_data_template_json: "{\"x\":0,\"y\":0}",
      rationale: "Offset one node to remove overlap while preserving hierarchy.",
      risk: "low",
    };
  }

  if (issueType === "NOT_CLICKABLE") {
    if (normalizeNonEmptyString(item.approx_reason) === "NO_RAYCAST_SOURCE") {
      return {
        ...base,
        strategy: "enable_raycast",
        recommended_action_type: "set_ui_image_raycast_target",
        action_data_template_json: "{\"raycast_target\":true}",
        rationale: "Enable raycast target to restore pointer hitability.",
        risk: "low",
      };
    }
    return {
      ...base,
      strategy: "reactivate_node",
      recommended_action_type: "set_active",
      action_data_template_json: "{\"active\":true}",
      rationale: "Restore active state and revalidate clickability.",
      risk: "medium",
    };
  }

  if (issueType === "TEXT_OVERFLOW") {
    if (style === "conservative") {
      return {
        ...base,
        strategy: "reduce_font_size",
        recommended_action_type: "set_ui_text_font_size",
        action_data_template_json: "{\"font_size\":24}",
        rationale: "Reduce font size first for low-risk overflow mitigation.",
        risk: "low",
      };
    }
    return {
      ...base,
      strategy: "expand_text_container",
      recommended_action_type: "set_rect_size_delta",
      action_data_template_json: "{\"x\":320,\"y\":80}",
      rationale: "Increase text container size to absorb overflow across resolutions.",
      risk: "medium",
    };
  }

  return base;
}

function normalizeRepairStyle(value) {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  if (
    normalized === "conservative" ||
    normalized === "balanced" ||
    normalized === "aggressive"
  ) {
    return normalized;
  }
  return "";
}

function normalizeRepairLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 6;
  }
  const rounded = Math.floor(numeric);
  return rounded > 20 ? 20 : rounded;
}

function mapFailure(error) {
  const source = error && typeof error === "object" ? error : {};
  const errorCode =
    normalizeNonEmptyString(source.error_code) ||
    normalizeNonEmptyString(source.errorCode) ||
    "E_UI_LAYOUT_VALIDATION_FAILED";
  const message =
    normalizeNonEmptyString(source.message) ||
    normalizeNonEmptyString(source.error_message) ||
    "Unity validate_ui_layout query failed";
  const suggestion = normalizeNonEmptyString(source.suggestion);
  const recoverable =
    typeof source.recoverable === "boolean" ? source.recoverable : undefined;
  return {
    statusCode: mapValidateErrorToStatusCode(errorCode),
    body: withMcpErrorFeedback({
      status: "failed",
      error_code: errorCode,
      message,
      ...(suggestion ? { suggestion } : {}),
      ...(recoverable === undefined ? {} : { recoverable }),
    }),
  };
}

function mapValidateErrorToStatusCode(errorCode) {
  const code = normalizeNonEmptyString(errorCode);
  if (code === "E_SCHEMA_INVALID") {
    return 400;
  }
  if (code === "E_QUERY_TIMEOUT") {
    return 504;
  }
  if (code === "E_UNITY_NOT_CONNECTED") {
    return 503;
  }
  if (code === "E_UI_LAYOUT_SCOPE_NOT_FOUND" || code === "E_TARGET_NOT_FOUND") {
    return 404;
  }
  return 409;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  executeValidateUiLayout,
};
