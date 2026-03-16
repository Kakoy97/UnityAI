"use strict";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeStepResponseStatus(stepResponse) {
  const body = isPlainObject(stepResponse && stepResponse.body) ? stepResponse.body : {};
  const bodyStatus = normalizeString(body.status).toLowerCase();
  if (body.ok === true || bodyStatus === "succeeded") {
    return "succeeded";
  }
  if (bodyStatus === "failed") {
    return "failed";
  }
  const statusCode = Number(stepResponse && stepResponse.statusCode);
  return Number.isFinite(statusCode) && statusCode >= 400 ? "failed" : "succeeded";
}

function buildSequentialBatchStepResult({ step, stepResponse }) {
  const sourceStep = isPlainObject(step) ? step : {};
  const response = isPlainObject(stepResponse) ? stepResponse : {};
  const body = isPlainObject(response.body) ? response.body : {};
  const data = isPlainObject(body.data) ? body.data : {};
  const status = normalizeStepResponseStatus(response);
  return {
    step_id: normalizeString(sourceStep.step_id),
    tool_name: normalizeString(sourceStep.tool_name),
    status,
    status_code: Number.isFinite(Number(response.statusCode))
      ? Number(response.statusCode)
      : status === "failed"
        ? 500
        : 200,
    ...(normalizeString(body.error_code) ? { error_code: normalizeString(body.error_code) } : {}),
    ...(normalizeString(body.message) ? { message: normalizeString(body.message) } : {}),
    ...(Object.keys(data).length > 0 ? { data: cloneJsonValue(data) } : {}),
  };
}

function buildSequentialBatchAggregateResult({
  batchPlan,
  stepResults,
  successfulStepIds,
  firstFailedStepId,
}) {
  const plan = isPlainObject(batchPlan) ? batchPlan : {};
  const normalizedStepResults = Array.isArray(stepResults) ? stepResults : [];
  const normalizedSuccessfulStepIds = Array.isArray(successfulStepIds)
    ? successfulStepIds.map((item) => normalizeString(item)).filter((item) => !!item)
    : [];
  const failedStepId = normalizeString(firstFailedStepId);
  return {
    batch_mode: "sequential_batch",
    status: failedStepId ? "failed" : "succeeded",
    failure_policy:
      normalizeString(plan.failure_policy) || "stop_on_first_failure",
    step_count: Number.isFinite(Number(plan.step_count))
      ? Math.max(0, Math.floor(Number(plan.step_count)))
      : normalizedStepResults.length,
    executed_step_count: normalizedStepResults.length,
    step_results: cloneJsonValue(normalizedStepResults),
    successful_step_ids: cloneJsonValue(normalizedSuccessfulStepIds),
    first_failed_step_id: failedStepId,
    rollback_applied: false,
  };
}

module.exports = {
  buildSequentialBatchStepResult,
  buildSequentialBatchAggregateResult,
};
