"use strict";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const DEFAULT_ENVELOPE_VALUES = {
  execution_mode: "execute",
  thread_id: "t_default",
  idempotency_key: "mock_idempotency_key",
  based_on_read_token: "mock_read_token",
  write_anchor_object_id: "mock_write_anchor_object_id",
  write_anchor_path: "Scene",
};

function getInputSchema(tool) {
  const input = tool && tool.input;
  return input && typeof input === "object" ? input : {};
}

function buildEnvelopeDefaults(tool) {
  const input = getInputSchema(tool);
  const props = input.properties && typeof input.properties === "object" ? input.properties : {};
  const required = Array.isArray(input.required) ? input.required : [];
  const defaults = {};
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_ENVELOPE_VALUES, field)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(props, field)) {
      continue;
    }
    defaults[field] = DEFAULT_ENVELOPE_VALUES[field];
  }
  return defaults;
}

function expandExample(tool, example) {
  const source = example && typeof example === "object" ? example : {};
  if (!source.request_business_only || source.request) {
    return cloneJson(source);
  }
  const envelopeDefaults = buildEnvelopeDefaults(tool);
  const fullRequest = {
    ...envelopeDefaults,
    ...cloneJson(source.request_business_only),
  };
  return {
    ...cloneJson(source),
    request: fullRequest,
  };
}

function expandBusinessOnlyExamples(dictionary) {
  const output = cloneJson(dictionary);
  output.tools = (output.tools || []).map((tool) => {
    const clonedTool = cloneJson(tool);
    const examples = Array.isArray(clonedTool.examples) ? clonedTool.examples : [];
    clonedTool.examples = examples.map((example) => expandExample(clonedTool, example));
    return clonedTool;
  });
  return output;
}

module.exports = {
  expandBusinessOnlyExamples,
};
