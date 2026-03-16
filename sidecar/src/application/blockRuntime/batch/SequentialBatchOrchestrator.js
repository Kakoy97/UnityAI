"use strict";

const {
  buildSequentialBatchStepResult,
  buildSequentialBatchAggregateResult,
} = require("./BatchResultFormatter");
const {
  advancePreviousReadTokenCandidate,
} = require("../execution");

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeBatchPlan(batchPlan) {
  const plan = isPlainObject(batchPlan) ? batchPlan : {};
  return {
    ...plan,
    steps: Array.isArray(plan.steps)
      ? plan.steps.filter((step) => isPlainObject(step))
      : [],
  };
}

function shouldInjectPreviousReadToken(stepPayload) {
  const payload = isPlainObject(stepPayload) ? stepPayload : {};
  if (normalizeString(payload.based_on_read_token)) {
    return false;
  }
  return (
    !!normalizeString(payload.execution_mode) ||
    !!normalizeString(payload.idempotency_key) ||
    !!normalizeString(payload.write_anchor_object_id) ||
    !!normalizeString(payload.write_anchor_path)
  );
}

function materializeSequentialBatchStep(step, previousReadTokenCandidate) {
  const sourceStep = isPlainObject(step) ? step : {};
  const payload = isPlainObject(sourceStep.payload) ? { ...sourceStep.payload } : {};
  const nextStep = {
    ...sourceStep,
    payload,
  };
  const tokenCandidate = normalizeString(previousReadTokenCandidate);
  if (tokenCandidate && shouldInjectPreviousReadToken(payload)) {
    nextStep.payload.based_on_read_token = tokenCandidate;
  }
  return nextStep;
}

function createStepFailureResponse(error) {
  const message =
    error && typeof error.message === "string" && error.message.trim()
      ? error.message.trim()
      : "sequential batch step failed unexpectedly";
  return {
    statusCode: 500,
    body: {
      ok: false,
      status: "failed",
      error_code: "E_BATCH_STEP_EXECUTION_FAILED",
      message,
    },
  };
}

function createSequentialBatchOrchestrator(options = {}) {
  const executeStep =
    options && typeof options.executeStep === "function" ? options.executeStep : null;

  return {
    async executeBatch({ batch_plan: rawBatchPlan }) {
      if (!executeStep) {
        throw new TypeError("executeStep is required for sequential batch orchestration");
      }

      const batchPlan = normalizeBatchPlan(rawBatchPlan);
      const stepResults = [];
      const successfulStepIds = [];
      let firstFailedStepId = "";
      let previousReadTokenCandidate = normalizeString(
        batchPlan.previous_read_token_candidate
      );

      for (const step of batchPlan.steps) {
        const materializedStep = materializeSequentialBatchStep(
          step,
          previousReadTokenCandidate
        );
        let stepResponse;
        try {
          stepResponse = await executeStep(materializedStep);
        } catch (error) {
          stepResponse = createStepFailureResponse(error);
        }

        const stepResult = buildSequentialBatchStepResult({
          step: materializedStep,
          stepResponse,
        });
        stepResults.push(stepResult);
        previousReadTokenCandidate = advancePreviousReadTokenCandidate(
          previousReadTokenCandidate,
          stepResult
        );

        if (stepResult.status === "succeeded") {
          successfulStepIds.push(normalizeString(stepResult.step_id));
          continue;
        }

        firstFailedStepId = normalizeString(stepResult.step_id);
        break;
      }

      return buildSequentialBatchAggregateResult({
        batchPlan,
        stepResults,
        successfulStepIds,
        firstFailedStepId,
      });
    },
  };
}

module.exports = {
  createSequentialBatchOrchestrator,
};
