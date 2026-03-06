"use strict";

const Ajv = require("ajv");
const { loadCompiledSchemas, normalizeCompiledSchemas } = require("./loadCompiledSchemas");
const { registerCaseInsensitiveKeyword } = require("./caseInsensitiveKeyword");
const { normalizeCaseInsensitiveEnums } = require("./schemaNormalizer");

let validatorRegistrySingleton = null;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createAjvInstance(options = {}) {
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    ...options,
  });
  registerCaseInsensitiveKeyword(ajv);
  return ajv;
}

function buildValidatorMap(ajv, compiledSchemas) {
  const validators = new Map();
  for (const schemaRecord of compiledSchemas.schemas) {
    const schema = schemaRecord.inputSchema;
    const properties =
      schema && typeof schema === "object" && schema.properties && typeof schema.properties === "object"
        ? schema.properties
        : {};
    const required =
      schema && typeof schema === "object" && Array.isArray(schema.required)
        ? schema.required
        : [];
    const hasTopLevelReadTokenProperty = Object.prototype.hasOwnProperty.call(
      properties,
      "based_on_read_token"
    );
    const hasTopLevelReadTokenRequired = required.includes("based_on_read_token");
    const kind =
      hasTopLevelReadTokenProperty || hasTopLevelReadTokenRequired ? "write" : "read";
    validators.set(schemaRecord.toolName, {
      toolName: schemaRecord.toolName,
      inputSchema: schema,
      kind,
      validateFn: ajv.compile(schema),
    });
  }
  return validators;
}

function createValidatorRegistry(options = {}) {
  const compiledSchemas = options.compiledSchemas
    ? normalizeCompiledSchemas(options.compiledSchemas, "createValidatorRegistry.compiledSchemas")
    : loadCompiledSchemas({ artifactPath: options.artifactPath });

  const ajv = options.ajv || createAjvInstance(options.ajvOptions || {});
  const validators = buildValidatorMap(ajv, compiledSchemas);

  function listToolNames() {
    return Array.from(validators.keys());
  }

  function hasTool(toolName) {
    return validators.has(String(toolName || "").trim());
  }

  function getInputSchema(toolName) {
    const key = String(toolName || "").trim();
    const record = validators.get(key);
    return record ? cloneJson(record.inputSchema) : null;
  }

  function validateToolInput(toolName, payload) {
    const key = String(toolName || "").trim();
    const record = validators.get(key);
    if (!record) {
      return {
        ok: false,
        error_code: "SSOT_TOOL_SCHEMA_NOT_FOUND",
        value: null,
        errors: [
          {
            keyword: "tool_name",
            instancePath: "",
            schemaPath: "",
            message: `No compiled schema found for tool "${key}"`,
          },
        ],
      };
    }

    const normalizedPayload = normalizeCaseInsensitiveEnums(record.inputSchema, payload);
    const valid = record.validateFn(normalizedPayload);
    if (valid) {
      return {
        ok: true,
        error_code: null,
        value: normalizedPayload,
        errors: [],
      };
    }

    return {
      ok: false,
      error_code: "SSOT_TOOL_SCHEMA_VALIDATION_FAILED",
      value: normalizedPayload,
      errors: cloneJson(record.validateFn.errors || []),
    };
  }

  function getToolMetadata(toolName) {
    const key = String(toolName || "").trim();
    const record = validators.get(key);
    if (!record) {
      return null;
    }
    return {
      toolName: record.toolName,
      kind: record.kind,
      inputSchema: cloneJson(record.inputSchema),
    };
  }

  function isWriteTool(toolName) {
    const metadata = getToolMetadata(toolName);
    return metadata ? metadata.kind === "write" : false;
  }

  return {
    version: compiledSchemas.version,
    listToolNames,
    hasTool,
    getToolMetadata,
    isWriteTool,
    getInputSchema,
    validateToolInput,
    ajv,
  };
}

function getValidatorRegistrySingleton(options = {}) {
  const hasCustomOptions =
    options &&
    typeof options === "object" &&
    Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return createValidatorRegistry(options);
  }
  if (!validatorRegistrySingleton) {
    validatorRegistrySingleton = createValidatorRegistry();
  }
  return validatorRegistrySingleton;
}

function resetValidatorRegistrySingletonForTests() {
  validatorRegistrySingleton = null;
}

module.exports = {
  createAjvInstance,
  createValidatorRegistry,
  getValidatorRegistrySingleton,
  resetValidatorRegistrySingletonForTests,
};
