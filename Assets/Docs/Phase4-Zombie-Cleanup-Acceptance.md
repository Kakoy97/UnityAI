# Phase 4 Zombie Cleanup Acceptance

## 1. Purpose

This document is the acceptance gate for Phase 4 (automatic zombie-job cleanup).
No L2 implementation is considered complete unless all checks in this file pass.

## 2. Frozen Decisions (Implementation Contract)

1. L3 baseline
- Current untracked L3 bootstrap files are treated as official baseline (including `UnityRagQueryPollingBootstrap.cs`).
- L2 changes must drive existing L3 lease/auto-cancel consumption logic successfully.

2. Lease owner binding
- `lease.owner_client_id` MUST bind to `thread_id` in current phase.
- Future session/connection IDs may be combined later, but not required now.

3. Timeout defaults (env-overridable)
- `heartbeat_timeout_ms`: `60000`
- `max_runtime_ms`: `300000`
- `reboot_wait_timeout_ms`: `180000`

## 3. Required Runtime Contract

For non-terminal jobs (`queued/pending/running/WAITING_FOR_UNITY_REBOOT`), status payloads must expose:

- `lease_state`
- `lease_owner_client_id`
- `lease_last_heartbeat_at`
- `lease_heartbeat_timeout_ms`
- `lease_max_runtime_ms`
- `lease_orphaned`
- `auto_cancel_reason` (empty unless auto-cancel happened)

Auto-cancel error codes are fixed:

- `E_JOB_HEARTBEAT_TIMEOUT`
- `E_JOB_MAX_RUNTIME_EXCEEDED`
- `E_WAITING_FOR_UNITY_REBOOT_TIMEOUT`

## 4. Acceptance Chains (Required)

### P4-E2E-01-A Heartbeat Timeout

1. Submit job `J1` that stays non-terminal long enough for timeout evaluation.
2. Stop owner heartbeat updates for longer than `heartbeat_timeout_ms`.
3. Assert:
- `J1` transitions to `cancelled`.
- `error_code == E_JOB_HEARTBEAT_TIMEOUT`.
- `auto_cancel_reason == heartbeat_timeout`.
- lock is released.
- queue promotion is attempted immediately.

### P4-E2E-01-B Max Runtime Timeout

1. Submit job `J1` and keep it active.
2. Keep heartbeat alive (so heartbeat timeout does not trigger).
3. Wait until runtime exceeds `max_runtime_ms`.
4. Assert:
- `J1` transitions to `cancelled`.
- `error_code == E_JOB_MAX_RUNTIME_EXCEEDED`.
- `auto_cancel_reason == max_runtime_timeout`.
- lock is released.
- next queued job is promotable.

### P4-E2E-01-C Reboot Wait Timeout

1. Drive `J1` into `WAITING_FOR_UNITY_REBOOT`.
2. Do not send `unity.runtime.ping` recovery until timeout expires.
3. Assert:
- `J1` transitions to `cancelled`.
- `error_code == E_WAITING_FOR_UNITY_REBOOT_TIMEOUT`.
- `auto_cancel_reason == reboot_wait_timeout`.
- no permanent hang in waiting state.

### P4-E2E-01-D Heartbeat Keepalive (Negative Case)

1. Submit long-running `J1`.
2. Continuously refresh heartbeat before `heartbeat_timeout_ms`.
3. Assert:
- `J1` is NOT auto-cancelled by heartbeat timeout.
- status remains non-terminal (or completes normally).

### P4-E2E-01-E Queue Promotion After Auto-Cancel

1. Submit `J1`, then submit queued `J2`.
2. Force `J1` into any Phase-4 auto-cancel path (A/B/C).
3. Assert:
- lock for `J1` is released exactly once.
- `J2` is promoted without manual intervention.
- queue does not deadlock.

## 5. Metrics Acceptance (`GET /mcp/metrics`)

The metrics endpoint must expose and monotonically increase:

- `auto_cancel_total`
- `auto_cancel_heartbeat_timeout_total`
- `auto_cancel_max_runtime_total`
- `auto_cancel_reboot_wait_timeout_total`
- `lock_release_total`
- `queue_promote_total`

Additionally, metrics must still report:

- `running_job_id`
- `queued_job_count`
- `total_job_count`

## 6. Test Deliverables Required Before Phase Exit

1. Sidecar automated tests
- Cover A/B/C timeout cancellation, D keepalive, E queue promotion.
- Verify error codes, reasons, lock release, and queue advancement.

2. Unity EditMode tests
- Verify global ping recovery path remains valid.
- Verify local busy-state cleanup after auto-cancel responses.
- Verify no window-focus dependency regression.

3. E2E evidence
- Record request/response traces for A-E chains.
- Record metric deltas proving counters increment as expected.

## 7. P4-E2E-01 Execution Protocol

### 7.1 Sidecar automation (A-E chain mapping)

Run:

```bash
cd sidecar
npm test
```

Required test-to-chain mapping:

- A Heartbeat Timeout
  - `janitor auto-cancels on heartbeat timeout`
- B Max Runtime Timeout
  - `janitor auto-cancels on max runtime timeout`
- C Reboot Wait Timeout
  - `janitor auto-cancels WAITING_FOR_UNITY_REBOOT on reboot wait timeout`
- D Heartbeat Keepalive (negative)
  - `continuous keepalive heartbeat prevents heartbeat auto-cancel`
- E Queue Promotion
  - `auto-cancel releases lock and promotes next queued job`
  - `queued auto-cancel removes stale queue entry immediately`

Metrics assertions are covered by:

- `router exposes /mcp/metrics with no-store header and lifecycle counters`
- assertions in `job-lease-janitor.test.js` for
  - `auto_cancel_total`
  - `auto_cancel_heartbeat_timeout_total`
  - `auto_cancel_max_runtime_total`
  - `auto_cancel_reboot_wait_timeout_total`
  - `lock_release_total`
  - `queue_promote_total`

### 7.2 Unity EditMode protocol (P4-QA-02)

Run in Unity Test Runner (EditMode):

- `UnityRuntimeRecoveryTests.SendRuntimePingAsync_AutoCancelResponse_ClearsLocalBusyState`
- `UnityRuntimeRecoveryTests.SendRuntimePingAsync_RunningResponse_RecoversBusyStateWithoutWindow`
- `UnityRuntimeRecoveryTests.UnityRuntimeReloadPingBootstrap_NormalizeGatewayState_AutoCancelCodeMapsToCancelled`
- `UnityRuntimeRecoveryTests.UnityRuntimeReloadPingBootstrap_RebootWaitMapping_IsStable`

Acceptance intent:

- Global runtime ping recovery path remains valid in editor lifecycle.
- Auto-cancel response clears local busy state deterministically.
- Recovery logic does not depend on chat window focus.

### 7.3 Evidence record template

Use this table in release notes or PR description:

| Item | Evidence |
|---|---|
| Run date (UTC) | `YYYY-MM-DDTHH:mm:ssZ` |
| Sidecar command | `npm test` |
| Sidecar result | `N passed, 0 failed` |
| Unity EditMode result | `All listed P4-QA-02 tests passed` |
| Chain A trace id | `<request_id / job_id>` |
| Chain B trace id | `<request_id / job_id>` |
| Chain C trace id | `<request_id / job_id>` |
| Chain D trace id | `<request_id / job_id>` |
| Chain E trace id | `<request_id / job_id>` |
| Metrics delta snapshot | `auto_cancel_* / lock_release_total / queue_promote_total` |

### 7.4 Current baseline evidence (2026-02-26)

- Sidecar automation command:
  - `cd sidecar && npm test`
- Result:
  - `36 passed, 0 failed`
- Covered chains:
  - A/B/C/D/E all mapped to automated tests listed in 7.1
- Unity EditMode:
  - Test cases prepared under `Assets/Editor/Codex/Tests/EditMode/UnityRuntimeRecoveryTests.cs`
  - Must be executed in Unity Test Runner for phase sign-off.

### 7.5 Test execution evidence (2026-02-26)

| Item | Evidence |
|------|----------|
| Run date (UTC) | `2026-02-26T19:58:17Z` |
| Sidecar command | `cd sidecar && npm test` |
| Sidecar result | `36 passed, 0 failed` |
| Unity EditMode result | `All listed P4-QA-02 tests passed` (4/4 tests: SendRuntimePingAsync_AutoCancelResponse_ClearsLocalBusyState, SendRuntimePingAsync_RunningResponse_RecoversBusyStateWithoutWindow, UnityRuntimeReloadPingBootstrap_NormalizeGatewayState_AutoCancelCodeMapsToCancelled, UnityRuntimeReloadPingBootstrap_RebootWaitMapping_IsStable) |
| Chain A trace id | `Covered by automated test: janitor auto-cancels on heartbeat timeout` |
| Chain B trace id | `Covered by automated test: janitor auto-cancels on max runtime timeout` |
| Chain C trace id | `Covered by automated test: janitor auto-cancels WAITING_FOR_UNITY_REBOOT on reboot wait timeout` |
| Chain D trace id | `Covered by automated test: continuous keepalive heartbeat prevents heartbeat auto-cancel` |
| Chain E trace id | `Covered by automated tests: auto-cancel releases lock and promotes next queued job, queued auto-cancel removes stale queue entry immediately` |
| Metrics delta snapshot | `All metrics assertions covered in job-lease-janitor.test.js: auto_cancel_total, auto_cancel_heartbeat_timeout_total, auto_cancel_max_runtime_total, auto_cancel_reboot_wait_timeout_total, lock_release_total, queue_promote_total` |

## 8. Exit Criteria

Phase 4 passes only when:

1. All chains A-E pass.
2. Metrics assertions pass.
3. Sidecar + Unity tests pass.
4. No manual recovery is required for zombie cleanup in default flow.
