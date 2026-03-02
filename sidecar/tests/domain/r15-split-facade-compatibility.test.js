"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const validatorsFacade = require("../../src/domain/validators");
const validatorsCore = require("../../src/domain/validators/coreValidators");
const validatorsWrite = require("../../src/domain/validators/mcpWriteValidators");
const validatorsLifecycle = require("../../src/domain/validators/lifecycleValidators");
const validatorsRead = require("../../src/domain/validators/readQueryValidators");
const validatorsUnity = require("../../src/domain/validators/unityCallbackValidators");

const turnUtilsFacade = require("../../src/utils/turnUtils");
const turnIds = require("../../src/utils/turn/ids");
const turnErrors = require("../../src/utils/turn/errors");
const turnHierarchy = require("../../src/utils/turn/hierarchy");
const turnMcpStatus = require("../../src/utils/turn/mcpStatus");
const turnSnapshot = require("../../src/utils/turn/snapshot");

test("R15-SPLIT-QA-01 validators facade keeps behavior parity with split modules", () => {
  assert.deepEqual(
    validatorsFacade.validateMcpGetSceneRoots({ request_id: "req_r15_scene_roots" }),
    validatorsRead.validateMcpGetSceneRoots({ request_id: "req_r15_scene_roots" })
  );
  assert.deepEqual(
    validatorsFacade.validateMcpApplyVisualActions({
      request_id: "req_r15_apply_visual_actions",
      actions: [],
    }),
    validatorsWrite.validateMcpApplyVisualActions({
      request_id: "req_r15_apply_visual_actions",
      actions: [],
    })
  );
  assert.deepEqual(
    validatorsFacade.validateMcpHeartbeat({ request_id: "req_r15_heartbeat" }),
    validatorsLifecycle.validateMcpHeartbeat({ request_id: "req_r15_heartbeat" })
  );
  assert.deepEqual(
    validatorsFacade.validateUnityCompileResult({
      ok: true,
      request_id: "req_r15_compile_result",
      compile_errors: [],
    }),
    validatorsUnity.validateUnityCompileResult({
      ok: true,
      request_id: "req_r15_compile_result",
      compile_errors: [],
    })
  );
  assert.deepEqual(
    validatorsFacade.enforceFixedErrorSuggestion("E_TARGET_NOT_FOUND", "custom-suggestion"),
    validatorsCore.enforceFixedErrorSuggestion("E_TARGET_NOT_FOUND", "custom-suggestion")
  );
});

test("R15-SPLIT-QA-01 turnUtils facade keeps behavior parity with split modules", () => {
  assert.equal(
    turnUtilsFacade.normalizeRequestId("  req_r15  "),
    turnIds.normalizeRequestId("  req_r15  ")
  );
  assert.equal(
    turnUtilsFacade.normalizeObjectId("  object_r15  "),
    turnIds.normalizeObjectId("  object_r15  ")
  );
  assert.equal(
    turnUtilsFacade.normalizeErrorCode(" e_target_not_found "),
    turnErrors.normalizeErrorCode(" e_target_not_found ")
  );
  assert.equal(
    turnUtilsFacade.pathLeafName("Scene/Canvas/HUD"),
    turnHierarchy.pathLeafName("Scene/Canvas/HUD")
  );
  assert.equal(
    turnUtilsFacade.mapTurnStateToMcpStatus("completed"),
    turnMcpStatus.mapTurnStateToMcpStatus("completed")
  );
  assert.equal(
    turnUtilsFacade.normalizeComponentAlias(" TMP_Text "),
    turnSnapshot.normalizeComponentAlias(" TMP_Text ")
  );
});
