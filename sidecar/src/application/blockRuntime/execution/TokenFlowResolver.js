"use strict";

const { WRITE_BLOCK_TYPES } = require("../contracts");

const TOKEN_FLOW_RESOLVER_VERSION = "phase1_step2a_t6_v1";

const EFFECTIVE_TOKEN_SOURCE = Object.freeze({
  NOT_WRITE_BLOCK: "not_write_block",
  PLAN_INITIAL_READ_TOKEN: "plan_initial_read_token",
  BLOCK_BASED_ON_READ_TOKEN: "block_based_on_read_token",
  PREVIOUS_READ_TOKEN_CANDIDATE: "previous_read_token_candidate",
  TRANSACTION_READ_TOKEN_CANDIDATE: "transaction_read_token_candidate",
  MISSING: "missing",
});

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isWriteBlock(blockSpec) {
  const blockType = normalizeString(blockSpec && blockSpec.block_type);
  return WRITE_BLOCK_TYPES.has(blockType);
}

function resolveEffectiveReadTokenForBlock(blockSpec, context = {}) {
  if (!isWriteBlock(blockSpec)) {
    return {
      token: "",
      source: EFFECTIVE_TOKEN_SOURCE.NOT_WRITE_BLOCK,
    };
  }

  const normalizedContext = isPlainObject(context) ? context : {};
  const executionShape = normalizeString(normalizedContext.shape) || "single_step";
  const planInitialReadToken = normalizeString(normalizedContext.plan_initial_read_token);
  const previousReadTokenCandidate = normalizeString(
    normalizedContext.previous_read_token_candidate
  );
  const transactionReadTokenCandidate = normalizeString(
    normalizedContext.transaction_read_token_candidate
  );
  const blockBasedReadToken = normalizeString(blockSpec && blockSpec.based_on_read_token);

  if (executionShape === "transaction") {
    if (planInitialReadToken) {
      return {
        token: planInitialReadToken,
        source: EFFECTIVE_TOKEN_SOURCE.PLAN_INITIAL_READ_TOKEN,
      };
    }
    if (blockBasedReadToken) {
      return {
        token: blockBasedReadToken,
        source: EFFECTIVE_TOKEN_SOURCE.BLOCK_BASED_ON_READ_TOKEN,
      };
    }
    if (transactionReadTokenCandidate) {
      return {
        token: transactionReadTokenCandidate,
        source: EFFECTIVE_TOKEN_SOURCE.TRANSACTION_READ_TOKEN_CANDIDATE,
      };
    }
    if (previousReadTokenCandidate) {
      return {
        token: previousReadTokenCandidate,
        source: EFFECTIVE_TOKEN_SOURCE.PREVIOUS_READ_TOKEN_CANDIDATE,
      };
    }
    return {
      token: "",
      source: EFFECTIVE_TOKEN_SOURCE.MISSING,
    };
  }

  if (blockBasedReadToken) {
    return {
      token: blockBasedReadToken,
      source: EFFECTIVE_TOKEN_SOURCE.BLOCK_BASED_ON_READ_TOKEN,
    };
  }
  if (previousReadTokenCandidate) {
    return {
      token: previousReadTokenCandidate,
      source: EFFECTIVE_TOKEN_SOURCE.PREVIOUS_READ_TOKEN_CANDIDATE,
    };
  }
  return {
    token: "",
    source: EFFECTIVE_TOKEN_SOURCE.MISSING,
  };
}

function materializeBlockSpecWithEffectiveToken(blockSpec, context = {}) {
  const sourceBlock = isPlainObject(blockSpec) ? blockSpec : {};
  const tokenOutcome = resolveEffectiveReadTokenForBlock(sourceBlock, context);
  if (!isWriteBlock(sourceBlock)) {
    return {
      block_spec: sourceBlock,
      token_flow: tokenOutcome,
    };
  }
  const materialized = {
    ...sourceBlock,
  };
  if (tokenOutcome.token) {
    materialized.based_on_read_token = tokenOutcome.token;
  }
  return {
    block_spec: materialized,
    token_flow: tokenOutcome,
  };
}

function extractReadTokenCandidateFromBlockResult(blockResult) {
  const result = isPlainObject(blockResult) ? blockResult : {};
  const status = normalizeString(result.status);
  if (status !== "succeeded") {
    return "";
  }
  return normalizeString(result.read_token_candidate);
}

module.exports = {
  TOKEN_FLOW_RESOLVER_VERSION,
  EFFECTIVE_TOKEN_SOURCE,
  resolveEffectiveReadTokenForBlock,
  materializeBlockSpecWithEffectiveToken,
  extractReadTokenCandidateFromBlockResult,
};

