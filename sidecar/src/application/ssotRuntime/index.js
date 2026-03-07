"use strict";

const { DEFAULT_COMPILED_SCHEMAS_PATH, loadCompiledSchemas } = require("./loadCompiledSchemas");
const {
  DEFAULT_SSOT_MCP_TOOLS_PATH,
  normalizeStaticToolCatalog,
  loadStaticToolCatalog,
  getStaticToolCatalogSingleton,
  resetStaticToolCatalogSingletonForTests,
} = require("./staticToolCatalog");
const { registerCaseInsensitiveKeyword } = require("./caseInsensitiveKeyword");
const { normalizeCaseInsensitiveEnums } = require("./schemaNormalizer");
const {
  createAjvInstance,
  createValidatorRegistry,
  getValidatorRegistrySingleton,
  resetValidatorRegistrySingletonForTests,
} = require("./validatorRegistry");
const {
  SSOT_TOKEN_PREFIX,
  SSOT_TOKEN_MIN_LENGTH,
  SSOT_TOKEN_HARD_MAX_AGE_MS,
  SSOT_TOKEN_CACHE_LIMIT,
  SSOT_UNKNOWN_SCENE_REVISION,
  SSOT_TOKEN_ERROR_CODES,
} = require("./tokenContract");
const {
  SsotTokenRegistry,
  getSsotTokenRegistrySingleton,
  resetSsotTokenRegistrySingletonForTests,
} = require("./ssotTokenRegistry");
const {
  SsotRevisionState,
  getSsotRevisionStateSingleton,
  resetSsotRevisionStateSingletonForTests,
} = require("./ssotRevisionState");
const {
  DEFAULT_TOKEN_POLICY_PATH,
  normalizeTokenPolicyManifest,
  loadTokenPolicyManifest,
  createTokenPolicyRuntime,
  getTokenPolicyRuntimeSingleton,
  resetTokenPolicyRuntimeSingletonForTests,
} = require("./tokenPolicyRuntime");
const {
  createTokenLifecycleOrchestrator,
  getTokenLifecycleOrchestratorSingleton,
  resetTokenLifecycleOrchestratorSingletonForTests,
} = require("./tokenLifecycleOrchestrator");
const {
  TokenLifecycleMetricsCollector,
  getTokenLifecycleMetricsCollectorSingleton,
  resetTokenLifecycleMetricsCollectorSingletonForTests,
} = require("./tokenLifecycleMetricsCollector");
const {
  createTokenDriftRecoveryCoordinator,
  getTokenDriftRecoveryCoordinatorSingleton,
  resetTokenDriftRecoveryCoordinatorSingletonForTests,
} = require("./tokenDriftRecoveryCoordinator");
const { validateSsotWriteToken } = require("./ssotWriteTokenGuard");
const { SSOT_QUERY_TYPES } = require("./queryTypes");
const { buildSsotQueryPayload, dispatchSsotRequest } = require("./dispatchSsotRequest");
const {
  DEFAULT_SSOT_DTOS_PATH,
  DEFAULT_SSOT_BINDINGS_PATH,
  simulateTryDeserializeByToolName,
} = require("./l3BindingPreview");
const {
  getActionCatalogView,
  getActionSchemaView,
  getToolSchemaView,
  getWriteContractBundleView,
} = require("./staticContractViews");

module.exports = {
  DEFAULT_COMPILED_SCHEMAS_PATH,
  loadCompiledSchemas,
  DEFAULT_SSOT_MCP_TOOLS_PATH,
  normalizeStaticToolCatalog,
  loadStaticToolCatalog,
  getStaticToolCatalogSingleton,
  resetStaticToolCatalogSingletonForTests,
  registerCaseInsensitiveKeyword,
  normalizeCaseInsensitiveEnums,
  createAjvInstance,
  createValidatorRegistry,
  getValidatorRegistrySingleton,
  resetValidatorRegistrySingletonForTests,
  SSOT_TOKEN_PREFIX,
  SSOT_TOKEN_MIN_LENGTH,
  SSOT_TOKEN_HARD_MAX_AGE_MS,
  SSOT_TOKEN_CACHE_LIMIT,
  SSOT_UNKNOWN_SCENE_REVISION,
  SSOT_TOKEN_ERROR_CODES,
  SsotTokenRegistry,
  getSsotTokenRegistrySingleton,
  resetSsotTokenRegistrySingletonForTests,
  SsotRevisionState,
  getSsotRevisionStateSingleton,
  resetSsotRevisionStateSingletonForTests,
  DEFAULT_TOKEN_POLICY_PATH,
  normalizeTokenPolicyManifest,
  loadTokenPolicyManifest,
  createTokenPolicyRuntime,
  getTokenPolicyRuntimeSingleton,
  resetTokenPolicyRuntimeSingletonForTests,
  createTokenLifecycleOrchestrator,
  getTokenLifecycleOrchestratorSingleton,
  resetTokenLifecycleOrchestratorSingletonForTests,
  TokenLifecycleMetricsCollector,
  getTokenLifecycleMetricsCollectorSingleton,
  resetTokenLifecycleMetricsCollectorSingletonForTests,
  createTokenDriftRecoveryCoordinator,
  getTokenDriftRecoveryCoordinatorSingleton,
  resetTokenDriftRecoveryCoordinatorSingletonForTests,
  validateSsotWriteToken,
  SSOT_QUERY_TYPES,
  buildSsotQueryPayload,
  dispatchSsotRequest,
  DEFAULT_SSOT_DTOS_PATH,
  DEFAULT_SSOT_BINDINGS_PATH,
  simulateTryDeserializeByToolName,
  getActionCatalogView,
  getActionSchemaView,
  getToolSchemaView,
  getWriteContractBundleView,
};
