# Case F Hotfix Regression Notes (R20-UX-HF-03)

Status: PASS
Date: 2026-03-03

## Implemented Code Hotfix
- HF-01: invalid `unity_action_request` is forwarded to execution gate and returns deterministic terminal failure instead of silent pending timeout.
- HF-02: for non-`create_gameobject` mutation actions, malformed optional `parent_anchor` is dropped when `target_anchor` is complete.

## Added Unity EditMode Guard Tests
- `UnityRuntimeRecoveryTests.SendRuntimePingAsync_InvalidCapturedActionEnvelope_ReportsDeterministicSchemaFailureWithoutTimeout`
- `UnityRuntimeRecoveryTests.SendRuntimePingAsync_MutationWithMalformedOptionalParentAnchor_AllowsExecutionAndReportsSuccess`
- `UnityAnchorExecutionTests.ConversationController_ValidateActionRequestPayload_AllowsMalformedOptionalParentAnchor_ForMutationAction`

## Manual Evidence Capture Checklist
1. Run Unity Test Runner (EditMode) and include `UnityRuntimeRecoveryTests` in the run scope.
2. Reproduce invalid envelope path once; archive response/status JSON to `case-f-invalid-envelope-fast-fail.json`.
3. Reproduce optional malformed `parent_anchor` mutation path once; archive response/status JSON to `case-f-optional-parent-anchor-compat.json`.
4. Update `docs/Phase20-Protocol-Usability-Acceptance.md` Case F status from `IN_PROGRESS` to `PASS` after evidence is archived.

## Pass Criteria
- `case-f-invalid-envelope-fast-fail.json` shows terminal failure with deterministic schema code and no `E_JOB_MAX_RUNTIME_EXCEEDED`.
- `case-f-optional-parent-anchor-compat.json` shows no silent pending loop; result reaches terminal success/failure quickly.

## Test Results
- Unity EditMode test results: `Assets/Docs/evidence/phase20/2026-03-03/case-f-unity-editmode-results.xml`
