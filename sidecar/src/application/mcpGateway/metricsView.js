"use strict";

const { cloneJson } = require("../../utils/turnUtils");
const { normalizeLease, toIsoTimestamp } = require("../jobRuntime/jobLease");
const { OBSERVABILITY_FREEZE_CONTRACT } = require("../../ports/contracts");
const { getMcpErrorFeedbackMetricsSnapshot } = require("./mcpErrorFeedback");
const {
  buildDefaultV1PolishMetricsSnapshot,
} = require("../v1PolishMetricsCollector");

function buildJobStatusPayload(gateway, job) {
  const item = job && typeof job === "object" ? job : {};
  const runtime =
    item.runtime && typeof item.runtime === "object" ? item.runtime : null;
  const visualActions =
    runtime && Array.isArray(runtime.visual_actions) ? runtime.visual_actions : [];
  const nextVisualIndex =
    runtime &&
    Number.isFinite(Number(runtime.next_visual_index)) &&
    Number(runtime.next_visual_index) >= 0
      ? Math.floor(Number(runtime.next_visual_index))
      : 0;
  const pendingVisualAction =
    visualActions[nextVisualIndex] &&
    typeof visualActions[nextVisualIndex] === "object"
      ? cloneJson(visualActions[nextVisualIndex])
      : null;
  const pendingVisualActionCount = pendingVisualAction
    ? Math.max(visualActions.length - nextVisualIndex, 0)
    : 0;
  const unityActionRequest =
    runtime &&
    runtime.last_action_request &&
    typeof runtime.last_action_request === "object"
      ? cloneJson(runtime.last_action_request)
      : null;
  const lease = normalizeLease(item.lease, {
    ownerClientId: item.thread_id || "",
    nowMs:
      Number.isFinite(Number(item.updated_at)) && Number(item.updated_at) > 0
        ? Number(item.updated_at)
        : Date.now(),
    defaultHeartbeatTimeoutMs: gateway.leaseHeartbeatTimeoutMs,
    defaultMaxRuntimeMs: gateway.leaseMaxRuntimeMs,
  });

  return {
    job_id: item.job_id || "",
    thread_id: item.thread_id || "",
    status: item.status || "pending",
    stage: item.stage || "",
    progress_message: item.progress_message || "",
    error_code: item.error_code || "",
    error_message: item.error_message || "",
    auto_cancel_reason: item.auto_cancel_reason || "",
    suggestion: item.suggestion || "",
    recoverable: item.recoverable === true,
    lease_state: lease.state || "",
    lease_owner_client_id: lease.owner_client_id || "",
    lease_last_heartbeat_at: toIsoTimestamp(lease.last_heartbeat_at),
    lease_heartbeat_timeout_ms: lease.heartbeat_timeout_ms,
    lease_max_runtime_ms: lease.max_runtime_ms,
    lease_orphaned: lease.orphaned === true,
    request_id: item.request_id || "",
    running_job_id: gateway.lockManager.getRunningJobId(),
    execution_report:
      item.execution_report && typeof item.execution_report === "object"
        ? cloneJson(item.execution_report)
        : null,
    pending_visual_action_count: pendingVisualActionCount,
    pending_visual_action: pendingVisualAction,
    unity_action_request: unityActionRequest,
    approval_mode: item.approval_mode || "auto",
    created_at:
      Number.isFinite(Number(item.created_at)) && Number(item.created_at) > 0
        ? new Date(Number(item.created_at)).toISOString()
        : gateway.nowIso(),
    updated_at:
      Number.isFinite(Number(item.updated_at)) && Number(item.updated_at) > 0
        ? new Date(Number(item.updated_at)).toISOString()
        : gateway.nowIso(),
  };
}

function getMcpMetrics(gateway) {
  const errorFeedbackMetrics = getMcpErrorFeedbackMetricsSnapshot();
  const observabilityPhase =
    OBSERVABILITY_FREEZE_CONTRACT &&
    typeof OBSERVABILITY_FREEZE_CONTRACT.phase === "string"
      ? OBSERVABILITY_FREEZE_CONTRACT.phase
      : "phase6_freeze";
  const baseMetrics = gateway.streamHub.getMetricsSnapshot({
    observability_phase: observabilityPhase,
    status_query_calls: gateway.statusQueryCalls,
    running_job_id: gateway.lockManager.getRunningJobId(),
    queued_job_count: gateway.jobQueue.size(),
    total_job_count: gateway.jobStore.listJobs().length,
    auto_cleanup_enforced: true,
    lease_heartbeat_timeout_ms: gateway.leaseHeartbeatTimeoutMs,
    lease_max_runtime_ms: gateway.leaseMaxRuntimeMs,
    reboot_wait_timeout_ms: gateway.rebootWaitTimeoutMs,
    lease_janitor_interval_ms: gateway.leaseJanitorIntervalMs,
    auto_cancel_total: gateway.lifecycleMetrics.auto_cancel_total,
    auto_cancel_heartbeat_timeout_total:
      gateway.lifecycleMetrics.auto_cancel_heartbeat_timeout_total,
    auto_cancel_max_runtime_total:
      gateway.lifecycleMetrics.auto_cancel_max_runtime_total,
    auto_cancel_reboot_wait_timeout_total:
      gateway.lifecycleMetrics.auto_cancel_reboot_wait_timeout_total,
    lock_release_total: gateway.lifecycleMetrics.lock_release_total,
    queue_promote_total: gateway.lifecycleMetrics.queue_promote_total,
    error_feedback_normalized_total:
      errorFeedbackMetrics.error_feedback_normalized_total,
    error_stack_sanitized_total:
      errorFeedbackMetrics.error_stack_sanitized_total,
    error_path_sanitized_total:
      errorFeedbackMetrics.error_path_sanitized_total,
    error_message_truncated_total:
      errorFeedbackMetrics.error_message_truncated_total,
    error_fixed_suggestion_enforced_total:
      errorFeedbackMetrics.error_fixed_suggestion_enforced_total,
    error_feedback_by_code: errorFeedbackMetrics.error_feedback_by_code,
  });
  const legacyGate = gateway.getLegacyAnchorGateSnapshot();
  const v1PolishMetrics =
    gateway && typeof gateway.getV1PolishMetricsSnapshot === "function"
      ? gateway.getV1PolishMetricsSnapshot()
      : null;
  const captureCompositeMetrics =
    gateway && typeof gateway.getCaptureCompositeMetricsSnapshot === "function"
      ? gateway.getCaptureCompositeMetricsSnapshot()
      : null;
  const protocolGovernanceMetrics =
    gateway &&
    typeof gateway.getProtocolGovernanceMetricsSnapshot === "function"
      ? gateway.getProtocolGovernanceMetricsSnapshot()
      : null;
  const statusQueryCalls =
    Number.isFinite(Number(baseMetrics.status_query_calls)) &&
    Number(baseMetrics.status_query_calls) >= 0
      ? Math.floor(Number(baseMetrics.status_query_calls))
      : 0;
  const lockReleaseTotal =
    Number.isFinite(Number(baseMetrics.lock_release_total)) &&
    Number(baseMetrics.lock_release_total) >= 0
      ? Math.floor(Number(baseMetrics.lock_release_total))
      : 0;
  const autoCancelMaxRuntimeTotal =
    Number.isFinite(Number(baseMetrics.auto_cancel_max_runtime_total)) &&
    Number(baseMetrics.auto_cancel_max_runtime_total) >= 0
      ? Math.floor(Number(baseMetrics.auto_cancel_max_runtime_total))
      : 0;
  const autoCancelTotal =
    Number.isFinite(Number(baseMetrics.auto_cancel_total)) &&
    Number(baseMetrics.auto_cancel_total) >= 0
      ? Math.floor(Number(baseMetrics.auto_cancel_total))
      : 0;
  const v1PolishSnapshot =
    v1PolishMetrics && typeof v1PolishMetrics === "object"
      ? v1PolishMetrics
      : buildDefaultV1PolishMetricsSnapshot({
          enabled: false,
          storageMode: "not_configured",
        });
  const v1Counters =
    v1PolishSnapshot.counters && typeof v1PolishSnapshot.counters === "object"
      ? v1PolishSnapshot.counters
      : {};
  const readTokenChecksTotal =
    Number.isFinite(Number(v1Counters.read_token_checks_total)) &&
    Number(v1Counters.read_token_checks_total) >= 0
      ? Math.floor(Number(v1Counters.read_token_checks_total))
      : 0;
  const readTokenExpiryTotal =
    Number.isFinite(Number(v1Counters.read_token_expiry_total)) &&
    Number(v1Counters.read_token_expiry_total) >= 0
      ? Math.floor(Number(v1Counters.read_token_expiry_total))
      : 0;
  const governanceBase =
    protocolGovernanceMetrics && typeof protocolGovernanceMetrics === "object"
      ? cloneJson(protocolGovernanceMetrics)
      : {
          schema_version: "r20_protocol_governance_metrics.v1",
          updated_at: "",
          counters: {
            write_tool_calls_total: 0,
            dry_run_alias_calls_total: 0,
            preflight_calls_total: 0,
            preflight_valid_total: 0,
            preflight_invalid_total: 0,
            preflight_blocking_error_total: 0,
            retry_fuse_blocked_total: 0,
            retry_fuse_failure_recorded_total: 0,
            retry_fuse_success_recorded_total: 0,
          },
          derived: {
            duplicate_retry_block_rate: 0,
            preflight_invalid_rate: 0,
            dry_run_alias_usage_rate: 0,
          },
          by_tool: [],
          lifecycle: {
            preflight_validate_write_payload: "stable",
            dry_run_alias_status: "deprecated_alias_supported",
          },
        };
  governanceBase.derived = {
    ...(governanceBase.derived && typeof governanceBase.derived === "object"
      ? governanceBase.derived
      : {}),
    avg_status_queries_per_terminal_job:
      lockReleaseTotal > 0
        ? Number((statusQueryCalls / lockReleaseTotal).toFixed(6))
        : 0,
    max_runtime_timeout_rate:
      autoCancelTotal > 0
        ? Number((autoCancelMaxRuntimeTotal / autoCancelTotal).toFixed(6))
        : 0,
    read_token_expiry_rate:
      readTokenChecksTotal > 0
        ? Number((readTokenExpiryTotal / readTokenChecksTotal).toFixed(6))
        : 0,
  };
  governanceBase.token = {
    read_token_checks_total: readTokenChecksTotal,
    read_token_expiry_total: readTokenExpiryTotal,
  };
  governanceBase.timeout = {
    auto_cancel_total: autoCancelTotal,
    auto_cancel_max_runtime_total: autoCancelMaxRuntimeTotal,
  };
  governanceBase.convergence = {
    status_query_calls: statusQueryCalls,
    lock_release_total: lockReleaseTotal,
  };
  return {
    ...baseMetrics,
    legacy_anchor_mode_requested: gateway.legacyAnchorModeRequested,
    legacy_anchor_mode_effective: gateway.legacyAnchorModeEffective,
    legacy_anchor_deny_signoff: gateway.legacyAnchorDenySignoff === true,
    legacy_anchor_deny_gate_required_days: legacyGate.requiredDays,
    legacy_anchor_zero_hit_window_days: legacyGate.zeroHitWindowDays,
    legacy_anchor_deny_gate_ready: legacyGate.ready,
    legacy_anchor_warn_hits_total: gateway.legacyAnchorModeMetrics.warn_hits_total,
    legacy_anchor_warn_hits_by_action: {
      ...gateway.legacyAnchorModeMetrics.warn_hits_by_action,
    },
    legacy_anchor_last_hit_at: gateway.legacyAnchorModeMetrics.last_hit_at || "",
    legacy_anchor_requested_deny_blocked_total:
      gateway.legacyAnchorModeMetrics.requested_deny_blocked_total,
    action_error_code_missing_total: gateway.actionErrorCodeMissingTotal,
    v1_polish_metrics: cloneJson(v1PolishSnapshot),
    r20_protocol_governance: governanceBase,
    capture_composite:
      captureCompositeMetrics && typeof captureCompositeMetrics === "object"
        ? cloneJson(captureCompositeMetrics)
        : {
            enabled: false,
            in_flight: false,
            fuse_failure_threshold: 3,
            fuse_cooldown_ms: 60000,
            fused: false,
            fused_until_ms: 0,
            fused_until: "",
            consecutive_failures: 0,
            total_failures: 0,
            total_black_failures: 0,
            total_error_failures: 0,
            total_fuse_trips: 0,
            total_fallback_renders: 0,
            total_probe_attempts: 0,
            total_probe_recoveries: 0,
            total_busy_rejections: 0,
            last_failure_at: "",
            last_failure_reason: "",
            last_fuse_opened_at: "",
            last_probe_recovered_at: "",
            last_busy_at: "",
          },
  };
}

module.exports = {
  buildJobStatusPayload,
  getMcpMetrics,
};
