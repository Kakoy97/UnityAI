#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { spawn } = require("child_process");

const TERMINAL_STATES = new Set(["completed", "error", "cancelled"]);
const DEFAULT_BASE_URL = "http://127.0.0.1:46321";
const DEFAULT_POLL_INTERVAL_MS = 200;
const DEFAULT_POLL_TIMEOUT_MS = 12000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = buildRunId(startedAt);
  let baseUrl = args.baseUrl;
  const iterations = args.iterations;
  const includeTurnSend = args.includeTurnSend;
  const includeTimeoutCase = args.includeTimeoutCase;
  const includeCodexTimeoutCase = args.includeCodexTimeoutCase;
  const includeQueryTimeoutCase = args.includeQueryTimeoutCase;
  const includeQueryProbeCase = args.includeQueryProbeCase;
  const spawnSidecar = args.spawnSidecar;
  const pollTimeoutMs = args.pollTimeoutMs;
  const pollIntervalMs = args.pollIntervalMs;

  const report = {
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: "",
    base_url: baseUrl,
    config: {
      iterations,
      include_turn_send: includeTurnSend,
      include_timeout_case: includeTimeoutCase,
      include_codex_timeout_case: includeCodexTimeoutCase,
      include_query_timeout_case: includeQueryTimeoutCase,
      include_query_probe_case: includeQueryProbeCase,
      spawn_sidecar: spawnSidecar,
      poll_timeout_ms: pollTimeoutMs,
      poll_interval_ms: pollIntervalMs,
      compile_timeout_ms: args.compileTimeoutMs || null,
      codex_soft_timeout_ms: args.codexSoftTimeoutMs || null,
      codex_hard_timeout_ms: args.codexHardTimeoutMs || null,
      unity_component_query_timeout_ms: args.unityComponentQueryTimeoutMs || null,
      use_fake_unity_query_planner:
        args.useFakeUnityQueryPlanner ||
        includeQueryTimeoutCase ||
        includeQueryProbeCase,
      fake_unity_query_mode: args.fakeUnityQueryMode || "chat_only",
      fake_unity_query_keep_component:
        args.fakeUnityQueryKeepComponent || "KeepComponent",
    },
    cases: [],
    summary: {
      passed: 0,
      failed: 0,
      warned: 0,
      total: 0,
    },
    metrics: {},
  };

  /** @type {null | { child: import("child_process").ChildProcess, startedByRunner: boolean }} */
  let spawned = null;
  const requiresIsolatedSpawn =
    spawnSidecar &&
    (includeTimeoutCase ||
      includeCodexTimeoutCase ||
      includeQueryTimeoutCase ||
      includeQueryProbeCase ||
      args.useFakeCodexTimeoutPlanner ||
      args.useFakeUnityQueryPlanner ||
      (Number.isFinite(args.compileTimeoutMs) && args.compileTimeoutMs > 0) ||
      (Number.isFinite(args.codexSoftTimeoutMs) && args.codexSoftTimeoutMs > 0) ||
      (Number.isFinite(args.codexHardTimeoutMs) && args.codexHardTimeoutMs > 0) ||
      (Number.isFinite(args.unityComponentQueryTimeoutMs) &&
        args.unityComponentQueryTimeoutMs > 0));

  let baseReachable = false;
  try {
    await ensureSidecarAvailability(baseUrl);
    baseReachable = true;
  } catch (error) {
    if (!spawnSidecar) {
      throw new Error(
        `Sidecar is not reachable at ${baseUrl}. Start sidecar first or use --spawn-sidecar.`
      );
    }
    spawned = await startSidecarIfNeeded(baseUrl, runId, {
      compileTimeoutMs: args.compileTimeoutMs,
      codexSoftTimeoutMs: args.codexSoftTimeoutMs,
      codexHardTimeoutMs: args.codexHardTimeoutMs,
      useFakeCodexTimeoutPlanner:
        args.useFakeCodexTimeoutPlanner || includeCodexTimeoutCase,
      useFakeUnityQueryPlanner:
        args.useFakeUnityQueryPlanner ||
        includeQueryTimeoutCase ||
        includeQueryProbeCase,
      unityComponentQueryTimeoutMs: args.unityComponentQueryTimeoutMs,
      fakeUnityQueryMode: args.fakeUnityQueryMode,
      fakeUnityQueryKeepComponent: args.fakeUnityQueryKeepComponent,
    });
  }

  if (requiresIsolatedSpawn && baseReachable) {
    const isolated = await startIsolatedSidecar(baseUrl, runId, {
      compileTimeoutMs: args.compileTimeoutMs,
      codexSoftTimeoutMs: args.codexSoftTimeoutMs,
      codexHardTimeoutMs: args.codexHardTimeoutMs,
      useFakeCodexTimeoutPlanner:
        args.useFakeCodexTimeoutPlanner || includeCodexTimeoutCase,
      useFakeUnityQueryPlanner:
        args.useFakeUnityQueryPlanner ||
        includeQueryTimeoutCase ||
        includeQueryProbeCase,
      unityComponentQueryTimeoutMs: args.unityComponentQueryTimeoutMs,
      fakeUnityQueryMode: args.fakeUnityQueryMode,
      fakeUnityQueryKeepComponent: args.fakeUnityQueryKeepComponent,
    });
    baseUrl = isolated.baseUrl;
    report.base_url = baseUrl;
    spawned = isolated.spawned;
  }

  await ensureSidecarAvailability(baseUrl);

  await runCase(report, "health_check", async () => {
    const res = await requestJson({
      method: "GET",
      url: `${baseUrl}/health`,
      timeoutMs: 6000,
    });
    assertStatus(res, 200, "health_check");
    if (!res.body || res.body.ok !== true) {
      throw new Error("health response missing ok=true");
    }
    return { active_request_id: res.body.active_request_id || "" };
  });

  await runCase(report, "session_start_replay", async () => {
    const requestId = `sess_${runId}`;
    const envelope = buildEnvelope({
      event: "session.start",
      requestId,
      threadId: `t_${runId}`,
      turnId: "u_000",
      payload: {
        workspace_root: process.cwd(),
        model: "codex",
      },
    });
    const first = await postJson(baseUrl, "/session/start", envelope);
    assertStatus(first, 200, "session_start(first)");
    if (first.body && first.body.replay !== false) {
      throw new Error("session_start(first) expected replay=false");
    }
    const second = await postJson(baseUrl, "/session/start", envelope);
    assertStatus(second, 200, "session_start(second)");
    if (second.body && second.body.replay !== true) {
      throw new Error("session_start(second) expected replay=true");
    }
    return {
      request_id: requestId,
      first_replay: first.body ? first.body.replay : undefined,
      second_replay: second.body ? second.body.replay : undefined,
    };
  });

  if (includeTurnSend) {
    await runCase(report, "turn_send_cancel_smoke", async () => {
      const requestId = `turn_${runId}`;
      const threadId = `t_turn_${runId}`;
      const turnId = "u_turn_smoke";
      const sendEnvelope = buildEnvelope({
        event: "turn.send",
        requestId,
        threadId,
        turnId,
        payload: {
          user_message: "smoke check",
          context: buildMinimalContext(),
        },
      });
      const sendRes = await postJson(baseUrl, "/turn/send", sendEnvelope);
      if (sendRes.statusCode === 429) {
        return {
          warning: "turn.send throttled by active request",
          active_request_id:
            sendRes.body && sendRes.body.active_request_id
              ? sendRes.body.active_request_id
              : "",
        };
      }
      if (sendRes.statusCode !== 200 && sendRes.statusCode !== 202) {
        throw new Error(
          `turn.send unexpected status=${sendRes.statusCode} body=${safeJson(
            sendRes.body
          )}`
        );
      }

      const accepted =
        sendRes.body && typeof sendRes.body.accepted === "boolean"
          ? sendRes.body.accepted
          : false;
      const warnings = [];
      if (!accepted) {
        warnings.push("turn.send accepted=false (planner likely unavailable)");
      } else {
        const cancelEnvelope = buildEnvelope({
          event: "turn.cancel",
          requestId,
          threadId,
          turnId,
          payload: {
            reason: "smoke_runner_cancel",
          },
        });
        const cancelRes = await postJson(baseUrl, "/turn/cancel", cancelEnvelope);
        if (cancelRes.statusCode !== 200) {
          warnings.push(
            `turn.cancel non-200 (status=${cancelRes.statusCode}, likely already terminal)`
          );
        }
      }

      const finalStatus = await waitForTurnTerminal({
        baseUrl,
        requestId,
        timeoutMs: pollTimeoutMs,
        pollIntervalMs,
      });
      if (!TERMINAL_STATES.has(finalStatus.state || "")) {
        throw new Error(
          `turn_send_cancel_smoke did not reach terminal state: ${safeJson(
            finalStatus
          )}`
        );
      }
      return {
        request_id: requestId,
        final_state: finalStatus.state,
        error_code: finalStatus.error_code || "",
        warnings,
      };
    });
  }

  for (let i = 1; i <= iterations; i += 1) {
    const caseName = `file_compile_round_${String(i).padStart(2, "0")}`;
    await runCase(report, caseName, async () => {
      const requestId = `smoke_file_${runId}_${i}`;
      const threadId = `t_file_${runId}`;
      const turnId = `u_file_${i}`;
      const scriptPath =
        "Assets/Scripts/AIGenerated/SmokeRunner/SmokeRunnerTemp.cs";
      const content = buildSmokeScriptContent(i, "SmokeRunnerTemp");
      const applyEnvelope = buildEnvelope({
        event: "file_actions.apply",
        requestId,
        threadId,
        turnId,
        payload: {
          file_actions: [
            {
              type: "create_file",
              path: scriptPath,
              content,
              overwrite_if_exists: true,
            },
          ],
          visual_layer_actions: [],
        },
      });

      const applyRes = await postJson(baseUrl, "/file-actions/apply", applyEnvelope);
      assertStatus(applyRes, 200, "file_actions.apply");
      if (!applyRes.body || applyRes.body.event !== "files.changed") {
        throw new Error("file_actions.apply expected event=files.changed");
      }

      const compileEnvelope = buildEnvelope({
        event: "unity.compile.result",
        requestId,
        threadId,
        turnId,
        payload: {
          success: true,
          duration_ms: 1,
          errors: [],
        },
      });
      const compileRes = await postJson(
        baseUrl,
        "/unity/compile/result",
        compileEnvelope
      );
      assertStatus(compileRes, 200, "unity.compile.result");

      const finalStatus = await waitForTurnTerminal({
        baseUrl,
        requestId,
        timeoutMs: pollTimeoutMs,
        pollIntervalMs,
      });
      if (finalStatus.state !== "completed") {
        throw new Error(
          `expected completed, got state=${finalStatus.state} error=${finalStatus.error_code || ""}`
        );
      }

      return {
        request_id: requestId,
        state: finalStatus.state,
        latest_event_seq: finalStatus.latest_event_seq || 0,
      };
    });
  }

  await runCase(report, "rename_visual_chain_round", async () => {
    const requestId = `rename_visual_${runId}`;
    const threadId = `t_rename_visual_${runId}`;
    const turnId = "u_rename_visual";
    const sourcePath =
      "Assets/Scripts/AIGenerated/SmokeRunner/Step3RenameSource.cs";
    const targetPath =
      "Assets/Scripts/AIGenerated/SmokeRunner/Step3RenameTarget.cs";
    const sourceContent = buildSmokeScriptContent(777, "Step3RenameTarget");

    const applyEnvelope = buildEnvelope({
      event: "file_actions.apply",
      requestId,
      threadId,
      turnId,
      payload: {
        file_actions: [
          {
            type: "create_file",
            path: sourcePath,
            content: sourceContent,
            overwrite_if_exists: true,
          },
          {
            type: "rename_file",
            old_path: sourcePath,
            new_path: targetPath,
            overwrite_if_exists: true,
          },
        ],
        visual_layer_actions: [
          {
            type: "remove_component",
            target: "selection",
            target_object_path: "Scene/Canvas/Image",
            component_name: "Step3LegacyComponent",
          },
        ],
      },
    });
    const applyRes = await postJson(baseUrl, "/file-actions/apply", applyEnvelope);
    assertStatus(applyRes, 200, "file_actions.apply(rename_visual_chain_round)");
    if (!applyRes.body || applyRes.body.event !== "files.changed") {
      throw new Error("rename_visual_chain_round expected event=files.changed");
    }

    const compileEnvelope = buildEnvelope({
      event: "unity.compile.result",
      requestId,
      threadId,
      turnId,
      payload: {
        success: true,
        duration_ms: 1,
        errors: [],
      },
    });
    const compileRes = await postJson(
      baseUrl,
      "/unity/compile/result",
      compileEnvelope
    );
    assertStatus(compileRes, 200, "unity.compile.result(rename_visual_chain_round)");
    const compileStatus = compileRes.body || {};
    const pendingAction =
      compileStatus &&
      compileStatus.unity_action_request &&
      compileStatus.unity_action_request.payload &&
      compileStatus.unity_action_request.payload.action
        ? compileStatus.unity_action_request.payload.action
        : null;
    if (!pendingAction || pendingAction.type !== "remove_component") {
      throw new Error(
        "rename_visual_chain_round expected unity_action_request for remove_component"
      );
    }

    const actionEnvelope = buildEnvelope({
      event: "unity.action.result",
      requestId,
      threadId,
      turnId,
      payload: {
        action_type: "remove_component",
        target: "selection",
        target_object_path: "Scene/Canvas/Image",
        component_name: "Step3LegacyComponent",
        component_assembly_qualified_name: "Step3LegacyComponent",
        success: true,
        error_message: "",
      },
    });
    const actionRes = await postJson(baseUrl, "/unity/action/result", actionEnvelope);
    assertStatus(actionRes, 200, "unity.action.result(rename_visual_chain_round)");

    const finalStatus = await waitForTurnTerminal({
      baseUrl,
      requestId,
      timeoutMs: pollTimeoutMs,
      pollIntervalMs,
    });
    if (finalStatus.state !== "completed") {
      throw new Error(
        `rename_visual_chain_round expected completed, got ${finalStatus.state} (${finalStatus.error_code || ""})`
      );
    }
    if (finalStatus.stage !== "completed") {
      throw new Error(
        `rename_visual_chain_round expected completed stage, got ${finalStatus.stage || ""}`
      );
    }

    return {
      request_id: requestId,
      state: finalStatus.state,
      stage: finalStatus.stage || "",
      expected_action_type: pendingAction.type,
      renamed_to: targetPath,
    };
  });

  await runCase(report, "action_result_mismatch_guard", async () => {
    const requestId = `action_mismatch_${runId}`;
    const threadId = `t_action_mismatch_${runId}`;
    const turnId = "u_action_mismatch";
    const targetObjectPath = "Scene/Canvas/Image";
    const expectedComponent = "Step3MismatchGuard";
    const wrongComponent = "WrongComponent";
    const markerPath =
      "Assets/Scripts/AIGenerated/SmokeRunner/Step3MismatchMarker.cs";
    const markerContent = buildSmokeScriptContent(778, "Step3MismatchMarker");

    const applyEnvelope = buildEnvelope({
      event: "file_actions.apply",
      requestId,
      threadId,
      turnId,
      payload: {
        file_actions: [
          {
            type: "create_file",
            path: markerPath,
            content: markerContent,
            overwrite_if_exists: true,
          },
        ],
        visual_layer_actions: [
          {
            type: "remove_component",
            target: "selection",
            target_object_path: targetObjectPath,
            component_name: expectedComponent,
          },
        ],
      },
    });
    const applyRes = await postJson(baseUrl, "/file-actions/apply", applyEnvelope);
    assertStatus(applyRes, 200, "file_actions.apply(action_result_mismatch_guard)");

    const compileEnvelope = buildEnvelope({
      event: "unity.compile.result",
      requestId,
      threadId,
      turnId,
      payload: {
        success: true,
        duration_ms: 1,
        errors: [],
      },
    });
    const compileRes = await postJson(
      baseUrl,
      "/unity/compile/result",
      compileEnvelope
    );
    assertStatus(compileRes, 200, "unity.compile.result(action_result_mismatch_guard)");

    const wrongActionEnvelope = buildEnvelope({
      event: "unity.action.result",
      requestId,
      threadId,
      turnId,
      payload: {
        action_type: "remove_component",
        target: "selection",
        target_object_path: targetObjectPath,
        component_name: wrongComponent,
        component_assembly_qualified_name: wrongComponent,
        success: true,
        error_message: "",
      },
    });
    const wrongActionRes = await postJson(
      baseUrl,
      "/unity/action/result",
      wrongActionEnvelope
    );
    if (wrongActionRes.statusCode !== 409) {
      throw new Error(
        `action_result_mismatch_guard expected 409 on mismatch, got ${wrongActionRes.statusCode}`
      );
    }
    const wrongErrorCode =
      wrongActionRes.body && wrongActionRes.body.error_code
        ? String(wrongActionRes.body.error_code)
        : "";
    const wrongStage =
      wrongActionRes.body && wrongActionRes.body.stage
        ? String(wrongActionRes.body.stage)
        : "";
    if (wrongStage !== "action_confirm_pending") {
      throw new Error(
        `action_result_mismatch_guard expected stage=action_confirm_pending, got ${wrongStage || "(empty)"}`
      );
    }

    const rightActionEnvelope = buildEnvelope({
      event: "unity.action.result",
      requestId,
      threadId,
      turnId,
      payload: {
        action_type: "remove_component",
        target: "selection",
        target_object_path: targetObjectPath,
        component_name: expectedComponent,
        component_assembly_qualified_name: expectedComponent,
        success: true,
        error_message: "",
      },
    });
    const rightActionRes = await postJson(
      baseUrl,
      "/unity/action/result",
      rightActionEnvelope
    );
    assertStatus(rightActionRes, 200, "unity.action.result(action_result_mismatch_guard)");

    const finalStatus = await waitForTurnTerminal({
      baseUrl,
      requestId,
      timeoutMs: pollTimeoutMs,
      pollIntervalMs,
    });
    if (finalStatus.state !== "completed") {
      throw new Error(
        `action_result_mismatch_guard expected completed, got ${finalStatus.state} (${finalStatus.error_code || ""})`
      );
    }

    return {
      request_id: requestId,
      mismatch_status: wrongActionRes.statusCode,
      mismatch_error_code: wrongErrorCode,
      mismatch_stage: wrongStage,
      final_state: finalStatus.state,
    };
  });

  await runCase(report, "domain_reload_wait_chain", async () => {
    const requestId = `domain_reload_${runId}`;
    const threadId = `t_domain_reload_${runId}`;
    const turnId = "u_domain_reload";
    const sourcePath =
      "Assets/Scripts/AIGenerated/SmokeRunner/Step3DomainReloadSource.cs";
    const targetPath =
      "Assets/Scripts/AIGenerated/SmokeRunner/Step3DomainReloadTarget.cs";
    const sourceContent = buildSmokeScriptContent(779, "Step3DomainReloadTarget");
    const componentA = "Step3DomainComponentA";
    const componentB = "Step3DomainComponentB";
    const targetObjectPath = "Scene/Canvas/Image";

    const applyEnvelope = buildEnvelope({
      event: "file_actions.apply",
      requestId,
      threadId,
      turnId,
      payload: {
        file_actions: [
          {
            type: "create_file",
            path: sourcePath,
            content: sourceContent,
            overwrite_if_exists: true,
          },
          {
            type: "rename_file",
            old_path: sourcePath,
            new_path: targetPath,
            overwrite_if_exists: true,
          },
        ],
        visual_layer_actions: [
          {
            type: "remove_component",
            target: "selection",
            target_object_path: targetObjectPath,
            component_name: componentA,
          },
          {
            type: "remove_component",
            target: "selection",
            target_object_path: targetObjectPath,
            component_name: componentB,
          },
        ],
      },
    });
    const applyRes = await postJson(baseUrl, "/file-actions/apply", applyEnvelope);
    assertStatus(applyRes, 200, "file_actions.apply(domain_reload_wait_chain)");

    const compileEnvelope = buildEnvelope({
      event: "unity.compile.result",
      requestId,
      threadId,
      turnId,
      payload: {
        success: true,
        duration_ms: 1,
        errors: [],
      },
    });
    const compileRes = await postJson(
      baseUrl,
      "/unity/compile/result",
      compileEnvelope
    );
    assertStatus(compileRes, 200, "unity.compile.result(domain_reload_wait_chain)");

    const waitActionEnvelope = buildEnvelope({
      event: "unity.action.result",
      requestId,
      threadId,
      turnId,
      payload: {
        action_type: "remove_component",
        target: "selection",
        target_object_path: targetObjectPath,
        component_name: componentA,
        component_assembly_qualified_name: componentA,
        success: false,
        error_code: "WAITING_FOR_UNITY_REBOOT",
        error_message: "Domain reload pending after script rename",
      },
    });
    const waitActionRes = await postJson(
      baseUrl,
      "/unity/action/result",
      waitActionEnvelope
    );
    if (waitActionRes.statusCode !== 202) {
      throw new Error(
        `domain_reload_wait_chain expected 202 for WAITING_FOR_UNITY_REBOOT, got ${waitActionRes.statusCode}`
      );
    }
    const waitFlag = !!(
      waitActionRes.body && waitActionRes.body.waiting_for_unity_reboot === true
    );
    if (!waitFlag) {
      throw new Error(
        "domain_reload_wait_chain expected waiting_for_unity_reboot=true"
      );
    }
    const waitStage =
      waitActionRes.body && waitActionRes.body.stage
        ? String(waitActionRes.body.stage)
        : "";
    if (waitStage !== "action_confirm_pending") {
      throw new Error(
        `domain_reload_wait_chain expected stage=action_confirm_pending after wait, got ${waitStage || "(empty)"}`
      );
    }

    const pingEnvelope = buildEnvelope({
      event: "unity.runtime.ping",
      requestId,
      threadId,
      turnId,
      payload: {
        status: "just_recompiled",
      },
    });
    const pingRes = await postJson(baseUrl, "/unity/runtime/ping", pingEnvelope);
    assertStatus(pingRes, 200, "unity.runtime.ping(domain_reload_wait_chain)");
    const recovered = !!(pingRes.body && pingRes.body.recovered === true);
    if (!recovered) {
      throw new Error("domain_reload_wait_chain expected runtime ping recovery");
    }

    const actionOneSuccessEnvelope = buildEnvelope({
      event: "unity.action.result",
      requestId,
      threadId,
      turnId,
      payload: {
        action_type: "remove_component",
        target: "selection",
        target_object_path: targetObjectPath,
        component_name: componentA,
        component_assembly_qualified_name: componentA,
        success: true,
        error_message: "",
      },
    });
    const actionOneRes = await postJson(
      baseUrl,
      "/unity/action/result",
      actionOneSuccessEnvelope
    );
    assertStatus(actionOneRes, 200, "unity.action.result(domain_reload_wait_chain:first)");
    const hasNextActionRequest = !!(
      actionOneRes.body &&
      actionOneRes.body.unity_action_request &&
      actionOneRes.body.unity_action_request.payload &&
      actionOneRes.body.unity_action_request.payload.action &&
      actionOneRes.body.unity_action_request.payload.action.component_name === componentB
    );
    if (!hasNextActionRequest) {
      throw new Error(
        "domain_reload_wait_chain expected next unity_action_request for second action"
      );
    }

    const actionTwoSuccessEnvelope = buildEnvelope({
      event: "unity.action.result",
      requestId,
      threadId,
      turnId,
      payload: {
        action_type: "remove_component",
        target: "selection",
        target_object_path: targetObjectPath,
        component_name: componentB,
        component_assembly_qualified_name: componentB,
        success: true,
        error_message: "",
      },
    });
    const actionTwoRes = await postJson(
      baseUrl,
      "/unity/action/result",
      actionTwoSuccessEnvelope
    );
    assertStatus(actionTwoRes, 200, "unity.action.result(domain_reload_wait_chain:second)");

    const finalStatus = await waitForTurnTerminal({
      baseUrl,
      requestId,
      timeoutMs: pollTimeoutMs,
      pollIntervalMs,
    });
    if (finalStatus.state !== "completed") {
      throw new Error(
        `domain_reload_wait_chain expected completed, got ${finalStatus.state} (${finalStatus.error_code || ""})`
      );
    }

    return {
      request_id: requestId,
      waiting_status_code: waitActionRes.statusCode,
      recovered,
      final_state: finalStatus.state,
      renamed_to: targetPath,
    };
  });

  await runCase(report, "domain_reload_wait_replace_chain", async () => {
    const requestId = `domain_reload_replace_${runId}`;
    const threadId = `t_domain_reload_replace_${runId}`;
    const turnId = "u_domain_reload_replace";
    const sourcePath =
      "Assets/Scripts/AIGenerated/SmokeRunner/Step3DomainReplaceSource.cs";
    const targetPath =
      "Assets/Scripts/AIGenerated/SmokeRunner/Step3DomainReplaceTarget.cs";
    const sourceContent = buildSmokeScriptContent(780, "Step3DomainReplaceTarget");
    const targetObjectPath = "Scene/Canvas/Image";
    const sourceComponent = "Step3SourceComponent";
    const replacementComponent = "Step3ReplacementComponent";
    const cleanupComponent = "Step3CleanupComponent";

    const applyEnvelope = buildEnvelope({
      event: "file_actions.apply",
      requestId,
      threadId,
      turnId,
      payload: {
        file_actions: [
          {
            type: "create_file",
            path: sourcePath,
            content: sourceContent,
            overwrite_if_exists: true,
          },
          {
            type: "rename_file",
            old_path: sourcePath,
            new_path: targetPath,
            overwrite_if_exists: true,
          },
        ],
        visual_layer_actions: [
          {
            type: "replace_component",
            target: "selection",
            target_object_path: targetObjectPath,
            source_component_assembly_qualified_name: sourceComponent,
            component_assembly_qualified_name: replacementComponent,
          },
          {
            type: "remove_component",
            target: "selection",
            target_object_path: targetObjectPath,
            component_name: cleanupComponent,
          },
        ],
      },
    });
    const applyRes = await postJson(baseUrl, "/file-actions/apply", applyEnvelope);
    assertStatus(applyRes, 200, "file_actions.apply(domain_reload_wait_replace_chain)");

    const compileEnvelope = buildEnvelope({
      event: "unity.compile.result",
      requestId,
      threadId,
      turnId,
      payload: {
        success: true,
        duration_ms: 1,
        errors: [],
      },
    });
    const compileRes = await postJson(
      baseUrl,
      "/unity/compile/result",
      compileEnvelope
    );
    assertStatus(compileRes, 200, "unity.compile.result(domain_reload_wait_replace_chain)");

    const waitActionEnvelope = buildEnvelope({
      event: "unity.action.result",
      requestId,
      threadId,
      turnId,
      payload: {
        action_type: "replace_component",
        target: "selection",
        target_object_path: targetObjectPath,
        source_component_assembly_qualified_name: sourceComponent,
        component_assembly_qualified_name: replacementComponent,
        success: false,
        error_code: "WAITING_FOR_UNITY_REBOOT",
        error_message: "Domain reload pending for replace action",
      },
    });
    const waitActionRes = await postJson(
      baseUrl,
      "/unity/action/result",
      waitActionEnvelope
    );
    if (waitActionRes.statusCode !== 202) {
      throw new Error(
        `domain_reload_wait_replace_chain expected 202 for WAITING_FOR_UNITY_REBOOT, got ${waitActionRes.statusCode}`
      );
    }
    const waitFlag = !!(
      waitActionRes.body && waitActionRes.body.waiting_for_unity_reboot === true
    );
    if (!waitFlag) {
      throw new Error(
        "domain_reload_wait_replace_chain expected waiting_for_unity_reboot=true"
      );
    }

    const pingEnvelope = buildEnvelope({
      event: "unity.runtime.ping",
      requestId,
      threadId,
      turnId,
      payload: {
        status: "just_recompiled",
      },
    });
    const pingRes = await postJson(baseUrl, "/unity/runtime/ping", pingEnvelope);
    assertStatus(pingRes, 200, "unity.runtime.ping(domain_reload_wait_replace_chain)");
    const recovered = !!(pingRes.body && pingRes.body.recovered === true);
    if (!recovered) {
      throw new Error("domain_reload_wait_replace_chain expected runtime ping recovery");
    }
    const recoveredActionType = !!(
      pingRes.body &&
      pingRes.body.unity_action_request &&
      pingRes.body.unity_action_request.payload &&
      pingRes.body.unity_action_request.payload.action &&
      pingRes.body.unity_action_request.payload.action.type === "replace_component"
    );
    if (!recoveredActionType) {
      throw new Error(
        "domain_reload_wait_replace_chain expected recovered replace_component request"
      );
    }

    const replaceSuccessEnvelope = buildEnvelope({
      event: "unity.action.result",
      requestId,
      threadId,
      turnId,
      payload: {
        action_type: "replace_component",
        target: "selection",
        target_object_path: targetObjectPath,
        source_component_assembly_qualified_name: sourceComponent,
        component_assembly_qualified_name: replacementComponent,
        success: true,
        error_message: "",
      },
    });
    const replaceRes = await postJson(
      baseUrl,
      "/unity/action/result",
      replaceSuccessEnvelope
    );
    assertStatus(replaceRes, 200, "unity.action.result(domain_reload_wait_replace_chain:replace)");

    const nextActionIsRemove = !!(
      replaceRes.body &&
      replaceRes.body.unity_action_request &&
      replaceRes.body.unity_action_request.payload &&
      replaceRes.body.unity_action_request.payload.action &&
      replaceRes.body.unity_action_request.payload.action.type === "remove_component" &&
      replaceRes.body.unity_action_request.payload.action.component_name === cleanupComponent
    );
    if (!nextActionIsRemove) {
      throw new Error(
        "domain_reload_wait_replace_chain expected next remove_component action request"
      );
    }

    const cleanupSuccessEnvelope = buildEnvelope({
      event: "unity.action.result",
      requestId,
      threadId,
      turnId,
      payload: {
        action_type: "remove_component",
        target: "selection",
        target_object_path: targetObjectPath,
        component_name: cleanupComponent,
        component_assembly_qualified_name: cleanupComponent,
        success: true,
        error_message: "",
      },
    });
    const cleanupRes = await postJson(
      baseUrl,
      "/unity/action/result",
      cleanupSuccessEnvelope
    );
    assertStatus(cleanupRes, 200, "unity.action.result(domain_reload_wait_replace_chain:cleanup)");

    const finalStatus = await waitForTurnTerminal({
      baseUrl,
      requestId,
      timeoutMs: pollTimeoutMs,
      pollIntervalMs,
    });
    if (finalStatus.state !== "completed") {
      throw new Error(
        `domain_reload_wait_replace_chain expected completed, got ${finalStatus.state} (${finalStatus.error_code || ""})`
      );
    }

    return {
      request_id: requestId,
      waiting_status_code: waitActionRes.statusCode,
      recovered,
      final_state: finalStatus.state,
      renamed_to: targetPath,
    };
  });

  await runCase(report, "file_guard_forbidden_path", async () => {
    const requestId = `forbidden_${runId}`;
    const threadId = `t_forbidden_${runId}`;
    const turnId = "u_forbidden";
    const envelope = buildEnvelope({
      event: "file_actions.apply",
      requestId,
      threadId,
      turnId,
      payload: {
        file_actions: [
          {
            type: "create_file",
            path: "Assets/Scenes/NotAllowed.cs",
            content: "public class NotAllowed {}",
            overwrite_if_exists: true,
          },
        ],
      },
    });
    const res = await postJson(baseUrl, "/file-actions/apply", envelope);
    if (res.statusCode !== 403) {
      throw new Error(`expected 403, got ${res.statusCode}`);
    }
    const errorCode = res.body && res.body.error_code ? res.body.error_code : "";
    if (errorCode !== "E_FILE_PATH_FORBIDDEN") {
      throw new Error(
        `expected error_code=E_FILE_PATH_FORBIDDEN, got ${errorCode || "(empty)"}`
      );
    }
    return {
      status_code: res.statusCode,
      error_code: errorCode,
    };
  });

  await runCase(report, "cancel_flow_compile_pending", async () => {
    const requestId = `cancel_${runId}`;
    const threadId = `t_cancel_${runId}`;
    const turnId = "u_cancel";
    const applyEnvelope = buildEnvelope({
      event: "file_actions.apply",
      requestId,
      threadId,
      turnId,
      payload: {
        file_actions: [
          {
            type: "create_file",
            path: "Assets/Scripts/AIGenerated/SmokeRunner/CancelTemp.cs",
            content: buildSmokeScriptContent(0, "CancelTemp"),
            overwrite_if_exists: true,
          },
        ],
      },
    });
    const applyRes = await postJson(baseUrl, "/file-actions/apply", applyEnvelope);
    assertStatus(applyRes, 200, "file_actions.apply(cancel_flow)");

    const cancelEnvelope = buildEnvelope({
      event: "turn.cancel",
      requestId,
      threadId,
      turnId,
      payload: {
        reason: "smoke_cancel_compile_pending",
      },
    });
    const cancelRes = await postJson(baseUrl, "/turn/cancel", cancelEnvelope);
    assertStatus(cancelRes, 200, "turn.cancel(cancel_flow)");

    const finalStatus = await waitForTurnTerminal({
      baseUrl,
      requestId,
      timeoutMs: pollTimeoutMs,
      pollIntervalMs,
    });
    if (finalStatus.state !== "cancelled") {
      throw new Error(`expected cancelled, got ${finalStatus.state}`);
    }
    return {
      request_id: requestId,
      state: finalStatus.state,
    };
  });

  if (includeTimeoutCase) {
    await runCase(report, "compile_timeout_sweep", async () => {
      const configuredCompileTimeoutMs =
        Number.isFinite(args.compileTimeoutMs) && args.compileTimeoutMs > 0
          ? Number(args.compileTimeoutMs)
          : 0;
      if (configuredCompileTimeoutMs <= 0) {
        return {
          warnings: [
            "compile_timeout_sweep skipped: compile timeout override is not configured",
          ],
        };
      }

      const requestId = `timeout_${runId}`;
      const threadId = `t_timeout_${runId}`;
      const turnId = "u_timeout";
      const applyEnvelope = buildEnvelope({
        event: "file_actions.apply",
        requestId,
        threadId,
        turnId,
        payload: {
          file_actions: [
            {
              type: "create_file",
              path: "Assets/Scripts/AIGenerated/SmokeRunner/TimeoutTemp.cs",
              content: buildSmokeScriptContent(999, "TimeoutTemp"),
              overwrite_if_exists: true,
            },
          ],
          visual_layer_actions: [],
        },
      });
      const applyRes = await postJson(baseUrl, "/file-actions/apply", applyEnvelope);
      assertStatus(applyRes, 200, "file_actions.apply(compile_timeout_sweep)");

      const waitTimeoutMs = Math.max(
        pollTimeoutMs,
        configuredCompileTimeoutMs + 3000
      );
      const finalStatus = await waitForTurnTerminal({
        baseUrl,
        requestId,
        timeoutMs: waitTimeoutMs,
        pollIntervalMs,
      });

      if (finalStatus.state !== "error") {
        throw new Error(
          `compile_timeout_sweep expected error state, got ${finalStatus.state}`
        );
      }
      if (finalStatus.error_code !== "E_COMPILE_TIMEOUT") {
        throw new Error(
          `compile_timeout_sweep expected E_COMPILE_TIMEOUT, got ${finalStatus.error_code || ""}`
        );
      }

      return {
        request_id: requestId,
        state: finalStatus.state,
        error_code: finalStatus.error_code,
        configured_compile_timeout_ms: configuredCompileTimeoutMs,
      };
    });
  }

  if (includeCodexTimeoutCase) {
    await runCase(report, "codex_timeout_sweep", async () => {
      const configuredSoftTimeoutMs =
        Number.isFinite(args.codexSoftTimeoutMs) && args.codexSoftTimeoutMs > 0
          ? Number(args.codexSoftTimeoutMs)
          : 0;
      const usingFakePlanner =
        args.useFakeCodexTimeoutPlanner || includeCodexTimeoutCase;
      if (configuredSoftTimeoutMs <= 0 || !usingFakePlanner) {
        return {
          warnings: [
            "codex_timeout_sweep skipped: requires fake timeout planner + codex soft timeout override",
          ],
        };
      }

      const requestId = `codex_timeout_${runId}`;
      const threadId = `t_codex_timeout_${runId}`;
      const turnId = "u_codex_timeout";
      const sendEnvelope = buildEnvelope({
        event: "turn.send",
        requestId,
        threadId,
        turnId,
        payload: {
          user_message: "timeout sweep request",
          context: buildMinimalContext(),
        },
      });
      const sendRes = await postJson(baseUrl, "/turn/send", sendEnvelope);
      if (sendRes.statusCode !== 200 && sendRes.statusCode !== 202) {
        throw new Error(
          `codex_timeout_sweep turn.send unexpected status=${sendRes.statusCode} body=${safeJson(
            sendRes.body
          )}`
        );
      }

      const waitTimeoutMs = Math.max(
        pollTimeoutMs,
        configuredSoftTimeoutMs + 5000
      );
      const finalStatus = await waitForTurnTerminal({
        baseUrl,
        requestId,
        timeoutMs: waitTimeoutMs,
        pollIntervalMs,
      });
      if (finalStatus.state !== "error") {
        throw new Error(
          `codex_timeout_sweep expected error state, got ${finalStatus.state}`
        );
      }
      if (finalStatus.error_code !== "E_CODEX_TIMEOUT") {
        throw new Error(
          `codex_timeout_sweep expected E_CODEX_TIMEOUT, got ${finalStatus.error_code || ""}`
        );
      }
      const events = Array.isArray(finalStatus.events) ? finalStatus.events : [];
      const hasAbortDiag = events.some(
        (item) => item && item.event === "diag.timeout.abort"
      );
      if (!hasAbortDiag) {
        throw new Error(
          "codex_timeout_sweep expected diag.timeout.abort event in terminal status events"
        );
      }

      return {
        request_id: requestId,
        state: finalStatus.state,
        error_code: finalStatus.error_code,
        has_abort_diagnostic: hasAbortDiag,
        configured_codex_soft_timeout_ms: configuredSoftTimeoutMs,
      };
    });
  }

  if (includeQueryTimeoutCase) {
    await runCase(report, "unity_query_timeout_non_blocking", async () => {
      const configuredQueryTimeoutMs =
        Number.isFinite(args.unityComponentQueryTimeoutMs) &&
        args.unityComponentQueryTimeoutMs > 0
          ? Number(args.unityComponentQueryTimeoutMs)
          : 0;
      const usingFakeQueryPlanner =
        args.useFakeUnityQueryPlanner || includeQueryTimeoutCase;
      if (configuredQueryTimeoutMs <= 0 || !usingFakeQueryPlanner) {
        return {
          warnings: [
            "unity_query_timeout_non_blocking skipped: requires fake unity query planner + query timeout override",
          ],
        };
      }

      const requestId = `query_timeout_${runId}`;
      const threadId = `t_query_timeout_${runId}`;
      const turnId = "u_query_timeout";
      const sendEnvelope = buildEnvelope({
        event: "turn.send",
        requestId,
        threadId,
        turnId,
        payload: {
          user_message: "query timeout fallback smoke request",
          context: buildMinimalContext(),
        },
      });
      const sendRes = await postJson(baseUrl, "/turn/send", sendEnvelope);
      if (sendRes.statusCode !== 200 && sendRes.statusCode !== 202) {
        throw new Error(
          `unity_query_timeout_non_blocking turn.send unexpected status=${sendRes.statusCode} body=${safeJson(
            sendRes.body
          )}`
        );
      }

      const waitTimeoutMs = Math.max(
        pollTimeoutMs,
        configuredQueryTimeoutMs + 8000
      );
      const finalStatus = await waitForTurnTerminal({
        baseUrl,
        requestId,
        timeoutMs: waitTimeoutMs,
        pollIntervalMs,
      });
      if (finalStatus.state !== "completed") {
        throw new Error(
          `unity_query_timeout_non_blocking expected completed state, got ${finalStatus.state} (${finalStatus.error_code || ""})`
        );
      }

      const events = Array.isArray(finalStatus.events) ? finalStatus.events : [];
      const hasQueryRequest = events.some(
        (item) => item && item.event === "unity.query.components.request"
      );
      if (!hasQueryRequest) {
        throw new Error(
          "unity_query_timeout_non_blocking expected unity.query.components.request event"
        );
      }

      const queryResultEvent = events
        .slice()
        .reverse()
        .find((item) => item && item.event === "unity.query.components.result");
      if (!queryResultEvent) {
        throw new Error(
          "unity_query_timeout_non_blocking expected unity.query.components.result event"
        );
      }

      const queryPayload =
        queryResultEvent.unity_query_components_result &&
        queryResultEvent.unity_query_components_result.payload &&
        typeof queryResultEvent.unity_query_components_result.payload === "object"
          ? queryResultEvent.unity_query_components_result.payload
          : null;
      const errorCode =
        queryPayload && typeof queryPayload.error_code === "string"
          ? queryPayload.error_code
          : "";
      if (errorCode !== "unity_busy_or_compiling") {
        throw new Error(
          `unity_query_timeout_non_blocking expected error_code=unity_busy_or_compiling, got ${errorCode || "(empty)"}`
        );
      }

      return {
        request_id: requestId,
        state: finalStatus.state,
        query_error_code: errorCode,
        configured_unity_query_timeout_ms: configuredQueryTimeoutMs,
      };
    });
  }

  if (includeQueryProbeCase) {
    await runCase(report, "unity_query_probe_success_chain", async () => {
      const usingFakeQueryPlanner =
        args.useFakeUnityQueryPlanner || includeQueryProbeCase;
      if (!usingFakeQueryPlanner) {
        return {
          warnings: [
            "unity_query_probe_success_chain skipped: requires fake unity query planner",
          ],
        };
      }

      const keepComponent =
        typeof args.fakeUnityQueryKeepComponent === "string" &&
        args.fakeUnityQueryKeepComponent.trim()
          ? args.fakeUnityQueryKeepComponent.trim()
          : "KeepComponent";
      const removeComponentA = "RemoveMeA";
      const removeComponentB = "RemoveMeB";

      const requestId = `query_probe_${runId}`;
      const threadId = `t_query_probe_${runId}`;
      const turnId = "u_query_probe";
      const sendEnvelope = buildEnvelope({
        event: "turn.send",
        requestId,
        threadId,
        turnId,
        payload: {
          user_message: "query probe success chain smoke request",
          context: buildMinimalContext(),
        },
      });
      const sendRes = await postJson(baseUrl, "/turn/send", sendEnvelope);
      if (sendRes.statusCode !== 200 && sendRes.statusCode !== 202) {
        throw new Error(
          `unity_query_probe_success_chain turn.send unexpected status=${sendRes.statusCode} body=${safeJson(
            sendRes.body
          )}`
        );
      }

      const queryRequestedStatus = await waitForTurnCondition({
        baseUrl,
        requestId,
        timeoutMs: pollTimeoutMs,
        pollIntervalMs,
        predicate: (status) =>
          !!extractLatestEvent(status.events, "unity.query.components.request"),
      });
      const queryRequestEvent = extractLatestEvent(
        queryRequestedStatus.events,
        "unity.query.components.request"
      );
      const queryRequestEnvelope =
        queryRequestEvent &&
        queryRequestEvent.unity_query_components_request &&
        typeof queryRequestEvent.unity_query_components_request === "object"
          ? queryRequestEvent.unity_query_components_request
          : null;
      const queryPayload =
        queryRequestEnvelope &&
        queryRequestEnvelope.payload &&
        typeof queryRequestEnvelope.payload === "object"
          ? queryRequestEnvelope.payload
          : null;
      const queryId =
        queryPayload && typeof queryPayload.query_id === "string"
          ? queryPayload.query_id
          : "";
      const targetPath =
        queryPayload && typeof queryPayload.target_path === "string"
          ? queryPayload.target_path
          : "Scene/Canvas/Image";
      if (!queryId) {
        throw new Error(
          "unity_query_probe_success_chain expected non-empty query_id"
        );
      }

      const queryResultEnvelope = buildEnvelope({
        event: "unity.query.components.result",
        requestId,
        threadId,
        turnId,
        payload: {
          query_id: queryId,
          target_path: targetPath,
          components: [
            {
              short_name: keepComponent,
              assembly_qualified_name: `${keepComponent}, Assembly-CSharp`,
            },
            {
              short_name: removeComponentA,
              assembly_qualified_name: `${removeComponentA}, Assembly-CSharp`,
            },
            {
              short_name: removeComponentB,
              assembly_qualified_name: `${removeComponentB}, Assembly-CSharp`,
            },
          ],
          error_code: "",
          error_message: "",
        },
      });
      const queryResultRes = await postJson(
        baseUrl,
        "/unity/query/components/result",
        queryResultEnvelope
      );
      assertStatus(
        queryResultRes,
        200,
        "unity.query.components.result(unity_query_probe_success_chain)"
      );

      const firstActionPendingStatus = await waitForTurnCondition({
        baseUrl,
        requestId,
        timeoutMs: pollTimeoutMs,
        pollIntervalMs,
        predicate: (status) =>
          !!extractLatestUnityActionRequestEvent(status.events),
      });
      const firstActionEvent = extractLatestUnityActionRequestEvent(
        firstActionPendingStatus.events
      );
      const firstAction =
        firstActionEvent &&
        firstActionEvent.unity_action_request &&
        firstActionEvent.unity_action_request.payload &&
        firstActionEvent.unity_action_request.payload.action &&
        typeof firstActionEvent.unity_action_request.payload.action === "object"
          ? firstActionEvent.unity_action_request.payload.action
          : null;
      if (!firstAction || firstAction.type !== "remove_component") {
        throw new Error(
          "unity_query_probe_success_chain expected first remove_component request"
        );
      }

      const requestedComponents = [];
      const firstComponentName =
        typeof firstAction.component_name === "string"
          ? firstAction.component_name
          : "";
      if (!firstComponentName) {
        throw new Error(
          "unity_query_probe_success_chain expected first action component_name"
        );
      }
      requestedComponents.push(firstComponentName);

      const firstActionResultEnvelope = buildEnvelope({
        event: "unity.action.result",
        requestId,
        threadId,
        turnId,
        payload: {
          action_type: "remove_component",
          target: "selection",
          target_object_path: targetPath,
          component_name: firstComponentName,
          component_assembly_qualified_name: firstComponentName,
          success: true,
          error_message: "",
        },
      });
      const firstActionRes = await postJson(
        baseUrl,
        "/unity/action/result",
        firstActionResultEnvelope
      );
      assertStatus(
        firstActionRes,
        200,
        "unity.action.result(unity_query_probe_success_chain:first)"
      );
      const secondAction =
        firstActionRes.body &&
        firstActionRes.body.unity_action_request &&
        firstActionRes.body.unity_action_request.payload &&
        firstActionRes.body.unity_action_request.payload.action &&
        typeof firstActionRes.body.unity_action_request.payload.action === "object"
          ? firstActionRes.body.unity_action_request.payload.action
          : null;
      if (!secondAction || secondAction.type !== "remove_component") {
        throw new Error(
          "unity_query_probe_success_chain expected second remove_component request"
        );
      }
      const secondComponentName =
        typeof secondAction.component_name === "string"
          ? secondAction.component_name
          : "";
      if (!secondComponentName) {
        throw new Error(
          "unity_query_probe_success_chain expected second action component_name"
        );
      }
      requestedComponents.push(secondComponentName);

      const secondActionResultEnvelope = buildEnvelope({
        event: "unity.action.result",
        requestId,
        threadId,
        turnId,
        payload: {
          action_type: "remove_component",
          target: "selection",
          target_object_path: targetPath,
          component_name: secondComponentName,
          component_assembly_qualified_name: secondComponentName,
          success: true,
          error_message: "",
        },
      });
      const secondActionRes = await postJson(
        baseUrl,
        "/unity/action/result",
        secondActionResultEnvelope
      );
      assertStatus(
        secondActionRes,
        200,
        "unity.action.result(unity_query_probe_success_chain:second)"
      );

      const finalStatus = await waitForTurnTerminal({
        baseUrl,
        requestId,
        timeoutMs: pollTimeoutMs,
        pollIntervalMs,
      });
      if (finalStatus.state !== "completed") {
        throw new Error(
          `unity_query_probe_success_chain expected completed state, got ${finalStatus.state} (${finalStatus.error_code || ""})`
        );
      }

      const requestedSet = new Set(requestedComponents);
      const expectedSet = new Set([removeComponentA, removeComponentB]);
      if (requestedSet.has(keepComponent)) {
        throw new Error(
          "unity_query_probe_success_chain should not remove keep component"
        );
      }
      if (requestedSet.size !== expectedSet.size) {
        throw new Error(
          `unity_query_probe_success_chain expected ${expectedSet.size} unique remove actions, got ${requestedSet.size}`
        );
      }
      for (const name of expectedSet) {
        if (!requestedSet.has(name)) {
          throw new Error(
            `unity_query_probe_success_chain missing remove action for ${name}`
          );
        }
      }

      return {
        request_id: requestId,
        state: finalStatus.state,
        requested_components: requestedComponents,
        keep_component: keepComponent,
      };
    });
  }

  report.finished_at = new Date().toISOString();
  report.summary.total = report.cases.length;
  report.metrics = buildMetrics(report.cases);
  const reportPath = writeReport(report);
  printSummary(report, reportPath);
  process.exitCode = report.summary.failed > 0 ? 1 : 0;

  if (spawned && spawned.startedByRunner) {
    await shutdownSpawnedSidecar(baseUrl, spawned.child);
  }
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    iterations: 20,
    includeTurnSend: true,
    includeTimeoutCase: false,
    includeCodexTimeoutCase: false,
    includeQueryTimeoutCase: false,
    includeQueryProbeCase: false,
    spawnSidecar: false,
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    compileTimeoutMs: 0,
    codexSoftTimeoutMs: 0,
    codexHardTimeoutMs: 0,
    useFakeCodexTimeoutPlanner: false,
    useFakeUnityQueryPlanner: false,
    unityComponentQueryTimeoutMs: 0,
    fakeUnityQueryMode: "chat_only",
    fakeUnityQueryKeepComponent: "KeepComponent",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--base-url" && i + 1 < argv.length) {
      args.baseUrl = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--iterations" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.iterations = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--poll-timeout-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.pollTimeoutMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--poll-interval-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.pollIntervalMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--include-turn-send") {
      args.includeTurnSend = true;
      continue;
    }
    if (token === "--skip-turn-send") {
      args.includeTurnSend = false;
      continue;
    }
    if (token === "--include-timeout-case") {
      args.includeTimeoutCase = true;
      continue;
    }
    if (token === "--skip-timeout-case") {
      args.includeTimeoutCase = false;
      continue;
    }
    if (token === "--spawn-sidecar") {
      args.spawnSidecar = true;
      continue;
    }
    if (token === "--include-codex-timeout-case") {
      args.includeCodexTimeoutCase = true;
      continue;
    }
    if (token === "--skip-codex-timeout-case") {
      args.includeCodexTimeoutCase = false;
      continue;
    }
    if (token === "--fake-codex-timeout-planner") {
      args.useFakeCodexTimeoutPlanner = true;
      continue;
    }
    if (token === "--include-query-timeout-case") {
      args.includeQueryTimeoutCase = true;
      continue;
    }
    if (token === "--skip-query-timeout-case") {
      args.includeQueryTimeoutCase = false;
      continue;
    }
    if (token === "--fake-unity-query-planner") {
      args.useFakeUnityQueryPlanner = true;
      continue;
    }
    if (token === "--include-query-probe-case") {
      args.includeQueryProbeCase = true;
      continue;
    }
    if (token === "--skip-query-probe-case") {
      args.includeQueryProbeCase = false;
      continue;
    }
    if (token === "--fake-unity-query-mode" && i + 1 < argv.length) {
      args.fakeUnityQueryMode = String(argv[i + 1] || "").trim() || "chat_only";
      i += 1;
      continue;
    }
    if (
      token === "--fake-unity-query-keep-component" &&
      i + 1 < argv.length
    ) {
      args.fakeUnityQueryKeepComponent =
        String(argv[i + 1] || "").trim() || "KeepComponent";
      i += 1;
      continue;
    }
    if (token === "--compile-timeout-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.compileTimeoutMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--codex-soft-timeout-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.codexSoftTimeoutMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--codex-hard-timeout-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.codexHardTimeoutMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--unity-query-timeout-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.unityComponentQueryTimeoutMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
  }
  return args;
}

async function runCase(report, name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    const warnings = Array.isArray(details && details.warnings)
      ? details.warnings
      : [];
    report.cases.push({
      name,
      status: warnings.length > 0 ? "warn" : "pass",
      duration_ms: Date.now() - started,
      details,
    });
    if (warnings.length > 0) {
      report.summary.warned += 1;
    } else {
      report.summary.passed += 1;
    }
  } catch (error) {
    report.cases.push({
      name,
      status: "fail",
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    report.summary.failed += 1;
  }
}

async function waitForTurnCondition(options) {
  const baseUrl = options.baseUrl;
  const requestId = options.requestId;
  const timeoutMs = options.timeoutMs;
  const pollIntervalMs = options.pollIntervalMs;
  const predicate =
    typeof options.predicate === "function" ? options.predicate : null;
  const start = Date.now();
  let lastStatus = null;

  while (Date.now() - start < timeoutMs) {
    const statusUrl = `${baseUrl}/turn/status?request_id=${encodeURIComponent(
      requestId
    )}`;
    const res = await requestJson({
      method: "GET",
      url: statusUrl,
      timeoutMs: Math.min(5000, pollIntervalMs + 2000),
    });
    if (res.statusCode === 200 && res.body) {
      lastStatus = res.body;
      if (!predicate || predicate(res.body)) {
        return res.body;
      }
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `turn did not satisfy condition within ${timeoutMs}ms (request_id=${requestId}, last=${safeJson(
      lastStatus
    )})`
  );
}

async function waitForTurnTerminal(options) {
  const baseUrl = options.baseUrl;
  const requestId = options.requestId;
  const timeoutMs = options.timeoutMs;
  const pollIntervalMs = options.pollIntervalMs;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const statusUrl = `${baseUrl}/turn/status?request_id=${encodeURIComponent(
      requestId
    )}`;
    const res = await requestJson({
      method: "GET",
      url: statusUrl,
      timeoutMs: Math.min(5000, pollIntervalMs + 2000),
    });
    if (res.statusCode === 200 && res.body && TERMINAL_STATES.has(res.body.state)) {
      return res.body;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `turn did not reach terminal state within ${timeoutMs}ms (request_id=${requestId})`
  );
}

function extractLatestEvent(events, eventName) {
  const items = Array.isArray(events) ? events : [];
  const target = typeof eventName === "string" ? eventName : "";
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item || typeof item !== "object") {
      continue;
    }
    if (item.event === target) {
      return item;
    }
  }
  return null;
}

function extractLatestUnityActionRequestEvent(events) {
  const items = Array.isArray(events) ? events : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item || typeof item !== "object") {
      continue;
    }
    const hasActionRequest =
      item.unity_action_request &&
      typeof item.unity_action_request === "object" &&
      item.unity_action_request.payload &&
      typeof item.unity_action_request.payload === "object" &&
      item.unity_action_request.payload.action &&
      typeof item.unity_action_request.payload.action === "object";
    if (!hasActionRequest) {
      continue;
    }
    if (item.event === "unity.action.request" || item.event === "turn.completed") {
      return item;
    }
  }
  return null;
}

async function ensureSidecarAvailability(baseUrl) {
  const res = await requestJson({
    method: "GET",
    url: `${baseUrl}/health`,
    timeoutMs: 3000,
  });
  if (res.statusCode !== 200 || !res.body || res.body.ok !== true) {
    throw new Error("health check failed");
  }
}

async function startSidecarIfNeeded(baseUrl, runId, options) {
  const url = new URL(baseUrl);
  const port = Number(url.port || 46321);
  const opts = options && typeof options === "object" ? options : {};
  const compileTimeoutMs =
    Number.isFinite(opts.compileTimeoutMs) && opts.compileTimeoutMs > 0
      ? String(Math.floor(opts.compileTimeoutMs))
      : "120000";
  const codexSoftTimeoutMs =
    Number.isFinite(opts.codexSoftTimeoutMs) && opts.codexSoftTimeoutMs > 0
      ? String(Math.floor(opts.codexSoftTimeoutMs))
      : "60000";
  const codexHardTimeoutMs =
    Number.isFinite(opts.codexHardTimeoutMs) && opts.codexHardTimeoutMs > 0
      ? String(Math.floor(opts.codexHardTimeoutMs))
      : "200000";
  const unityComponentQueryTimeoutMs =
    Number.isFinite(opts.unityComponentQueryTimeoutMs) &&
    opts.unityComponentQueryTimeoutMs > 0
      ? String(Math.floor(opts.unityComponentQueryTimeoutMs))
      : "5000";
  const useFakeCodexTimeoutPlanner = !!opts.useFakeCodexTimeoutPlanner;
  const useFakeUnityQueryPlanner = !!opts.useFakeUnityQueryPlanner;
  const fakeUnityQueryMode =
    typeof opts.fakeUnityQueryMode === "string" && opts.fakeUnityQueryMode.trim()
      ? opts.fakeUnityQueryMode.trim()
      : "chat_only";
  const fakeUnityQueryKeepComponent =
    typeof opts.fakeUnityQueryKeepComponent === "string" &&
    opts.fakeUnityQueryKeepComponent.trim()
      ? opts.fakeUnityQueryKeepComponent.trim()
      : "KeepComponent";
  const sidecarRoot = path.resolve(__dirname, "..");
  const child = spawn(process.execPath, ["index.js", "--port", String(port)], {
    cwd: sidecarRoot,
    env: {
      ...process.env,
      USE_CODEX_APP_SERVER: "false",
      USE_FAKE_CODEX_TIMEOUT_PLANNER: useFakeCodexTimeoutPlanner
        ? "true"
        : "false",
      USE_FAKE_UNITY_QUERY_PLANNER:
        !useFakeCodexTimeoutPlanner && useFakeUnityQueryPlanner
          ? "true"
          : "false",
      FAKE_UNITY_QUERY_MODE: fakeUnityQueryMode,
      FAKE_UNITY_QUERY_KEEP_COMPONENT: fakeUnityQueryKeepComponent,
      CODEX_SOFT_TIMEOUT_MS: codexSoftTimeoutMs,
      CODEX_HARD_TIMEOUT_MS: codexHardTimeoutMs,
      COMPILE_TIMEOUT_MS: compileTimeoutMs,
      UNITY_COMPONENT_QUERY_TIMEOUT_MS: unityComponentQueryTimeoutMs,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines = [];
  const collect = (chunk) => {
    const text = String(chunk || "").trim();
    if (!text) {
      return;
    }
    lines.push(text);
    if (lines.length > 40) {
      lines.shift();
    }
  };
  if (child.stdout) {
    child.stdout.on("data", collect);
  }
  if (child.stderr) {
    child.stderr.on("data", collect);
  }

  const bootDeadline = Date.now() + 15000;
  while (Date.now() < bootDeadline) {
    await sleep(250);
    try {
      await ensureSidecarAvailability(baseUrl);
      return { child, startedByRunner: true };
    } catch {
      // keep waiting
    }
    if (child.exitCode !== null) {
      break;
    }
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  throw new Error(
    `failed to start sidecar (run=${runId}). logs=${lines.slice(-8).join(" | ")}`
  );
}

async function startIsolatedSidecar(baseUrl, runId, options) {
  const seed = new URL(baseUrl);
  const seedPort = Number(seed.port || (seed.protocol === "https:" ? 443 : 80));
  const maxAttempts = 20;
  let lastError = null;

  for (let offset = 1; offset <= maxAttempts; offset += 1) {
    const candidatePort = seedPort + offset;
    const candidateBaseUrl = buildUrlWithPort(seed, candidatePort);
    try {
      await ensureSidecarAvailability(candidateBaseUrl);
      continue;
    } catch {
      // candidate looks free for sidecar startup attempt
    }

    try {
      const spawned = await startSidecarIfNeeded(candidateBaseUrl, runId, options);
      return {
        baseUrl: candidateBaseUrl,
        spawned,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `failed to start isolated sidecar after ${maxAttempts} ports: ${
      lastError instanceof Error ? lastError.message : String(lastError || "unknown")
    }`
  );
}

function buildUrlWithPort(seedUrl, port) {
  const clone = new URL(seedUrl.toString());
  clone.port = String(port);
  return clone.toString().replace(/\/$/, "");
}

async function shutdownSpawnedSidecar(baseUrl, child) {
  try {
    await postJson(baseUrl, "/admin/shutdown", {});
  } catch {
    // ignore shutdown endpoint errors
  }
  await sleep(300);
  if (child && child.exitCode === null) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

function buildMinimalContext() {
  return {
    selection: {
      mode: "selection",
      target_object_path: "Scene/Canvas/Image",
      prefab_path: "",
    },
    selection_tree: {
      max_depth: 2,
      root: {
        name: "Image",
        path: "Scene/Canvas/Image",
        depth: 0,
        components: ["Transform", "Image"],
        children: [],
      },
      truncated_node_count: 0,
      truncated_reason: "",
    },
  };
}

function buildEnvelope(input) {
  return {
    event: input.event,
    request_id: input.requestId,
    thread_id: input.threadId,
    turn_id: input.turnId,
    timestamp: new Date().toISOString(),
    payload: input.payload || {},
  };
}

function buildSmokeScriptContent(index, className) {
  const normalizedClassName =
    typeof className === "string" && className.trim()
      ? className.trim()
      : "SmokeRunnerTemp";
  return [
    "using UnityEngine;",
    "",
    `public class ${normalizedClassName} : MonoBehaviour`,
    "{",
    "    private void Start()",
    "    {",
    `        Debug.Log(\"[SmokeRunner] round ${index}\");`,
    "    }",
    "}",
    "",
  ].join("\n");
}

function buildRunId(date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  const pid = String(process.pid || 0).padStart(5, "0");
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    "_",
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
    ms,
    "_",
    pid,
    "_",
    rand,
  ].join("");
}

function writeReport(report) {
  const stateDir = path.resolve(__dirname, "..", ".state");
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, `smoke-turn-report-${report.run_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function printSummary(report, reportPath) {
  const elapsedMs =
    Date.parse(report.finished_at || new Date().toISOString()) -
    Date.parse(report.started_at);
  const lines = [
    `[smoke] run_id=${report.run_id}`,
    `[smoke] base_url=${report.base_url}`,
    `[smoke] total=${report.summary.total} pass=${report.summary.passed} warn=${report.summary.warned} fail=${report.summary.failed}`,
    `[smoke] elapsed_ms=${Number.isFinite(elapsedMs) ? elapsedMs : 0}`,
    `[smoke] report=${reportPath}`,
  ];
  for (const line of lines) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
  if (report.summary.failed > 0) {
    // eslint-disable-next-line no-console
    console.error("[smoke] failing cases:");
    for (const item of report.cases) {
      if (item.status === "fail") {
        // eslint-disable-next-line no-console
        console.error(`  - ${item.name}: ${item.error}`);
      }
    }
  }
}

function buildMetrics(cases) {
  const items = Array.isArray(cases) ? cases : [];
  const allDurations = items
    .map((item) => Number(item && item.duration_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const compileRoundDurations = items
    .filter(
      (item) =>
        item &&
        typeof item.name === "string" &&
        item.name.startsWith("file_compile_round_")
    )
    .map((item) => Number(item.duration_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);

  return {
    case_duration_ms: quantiles(allDurations),
    file_compile_round_duration_ms: quantiles(compileRoundDurations),
  };
}

function quantiles(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
      avg: 0,
    };
  }
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    avg: Math.round((sum / sorted.length) * 100) / 100,
  };
}

function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return 0;
  }
  const ratio = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
  const rank = Math.ceil(ratio * sortedValues.length) - 1;
  const index = rank < 0 ? 0 : rank;
  return sortedValues[index];
}

async function postJson(baseUrl, pathname, body) {
  return requestJson({
    method: "POST",
    url: `${baseUrl}${pathname}`,
    body,
    timeoutMs: 10000,
  });
}

function assertStatus(res, expectedStatusCode, label) {
  if (res.statusCode !== expectedStatusCode) {
    throw new Error(
      `${label} expected status=${expectedStatusCode}, got ${res.statusCode} body=${safeJson(
        res.body
      )}`
    );
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function requestJson(input) {
  const method = input.method || "GET";
  const timeoutMs =
    Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? Number(input.timeoutMs)
      : 10000;
  const url = new URL(input.url);
  const isHttps = url.protocol === "https:";
  const payload =
    input.body !== undefined ? Buffer.from(JSON.stringify(input.body), "utf8") : null;
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json; charset=utf-8",
              "Content-Length": String(payload.length),
            }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body = null;
          if (text) {
            try {
              body = JSON.parse(text);
            } catch {
              body = { raw: text };
            }
          }
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body,
          });
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }

    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.on("close", () => {
      clearTimeout(timer);
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    `[smoke] fatal: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
