# Phase 11 Architecture Decoupling Acceptance

## 1. Scope
- This document is the single acceptance entry for:
  - `ARCH-ASSET-01`
  - `ARCH-QA-01`
  - `ARCH-QA-02`
  - `ARCH-E2E-01`
- It freezes the Phase D closure baseline after L2/L3/L3Q refactors.

## 2. Success Criteria
1. Sidecar regression gates are green and include coverage for F1/F2/F6/F9/F10.
2. Unity EditMode gate suites are present and runnable for F4/F5/F7/F9/F11.
3. E2E acceptance path is reproducible from one document with traceable evidence.
4. New contributors can find the complete path from the main index and this file only.

## 3. Preconditions
1. Sidecar environment ready:
```bash
cd sidecar
npm install
```
2. Unity project opens and compiles in Editor.
3. Sidecar service endpoint available at `http://127.0.0.1:46321`.

## 4. Automated Gates

### 4.1 ARCH-QA-01 Sidecar Gates
Run the focused Phase D gate:
```bash
cd sidecar
npm run test:phase-d:qa
```

Run full sidecar regression before sign-off:
```bash
cd sidecar
npm test
```

Expected:
- All tests pass.
- Includes:
  - schema/validator consistency
  - tool visibility freeze
  - token budget guard
  - legacy anchor migration guard
  - error-code fidelity guard
  - query dual-stack contract guard

### 4.2 ARCH-QA-02 Unity EditMode Gates
Run these suites in Unity Test Runner (`EditMode`):
- `UnityQueryControllerClosureTests`
- `UnityQueryRegistryDispatchTests`
- `UnityQueryRegistryTests`
- `SidecarContractsExtensibilityDtoTests`
- `SidecarContractsSnapshotTests`
- `UnityVisualActionRegistryExecutorTests`
- `UnityErrorFeedbackReceiptTests`
- `UnityAnchorExecutionTests`
- `UnityRagReadServiceScreenshotTests`
- `UnityRagReadServiceUiTreeTests`
- `UnityVisualReadChainTests`

Expected:
- Compile succeeds.
- All listed suites pass.

## 5. End-to-End Acceptance Path (ARCH-E2E-01)

### Case A: Tool governance and visibility
1. Verify tool visibility/freeze with automated gate:
```bash
cd sidecar
node --test "tests/application/r12-tool-registry-consistency.test.js" "tests/application/r12-tool-visibility-freeze.test.js"
```
2. Expected:
- Visible tools follow `exposed ∩ allowlist - disabled`.
- Disabled tool remains non-callable.

### Case B: Unknown action fail-closed
1. Run:
```bash
cd sidecar
node --test "tests/application/mcp-command-unknown-action-fail-closed.test.js"
```
2. Expected:
- Unknown action is submit-open but execute-closed.
- Returns `E_ACTION_HANDLER_NOT_FOUND` (no generic swallow).

### Case C: Query dual-stack contract
1. Run:
```bash
cd sidecar
node --test "tests/application/r11-query-and-tools-cache.test.js"
```
2. Expected pull envelope contains:
- `query_contract_version`
- `query_payload_json`
- legacy `payload` (during migration window)

### Case D: Controller no-branch onboarding regression
1. Run Unity EditMode suite:
- `UnityQueryControllerClosureTests`
2. Expected:
- No per-query branch reintroduced in `ConversationController`.
- Registry dispatch remains the only query dispatch path.

## 6. Evidence Checklist
Store acceptance artifacts under:
- `Assets/Docs/evidence/phase11/<yyyy-mm-dd>/`

Required artifacts:
1. Sidecar gate output logs (`test:phase-d:qa`, `npm test`).
2. Unity EditMode runner screenshot(s) showing suite pass.
3. E2E case command output snapshots (Case A/B/C).
4. Any failure triage notes and rerun evidence.

## 7. Sign-off
- [ ] `ARCH-ASSET-01` complete (entry points and docs consistent).
- [ ] `ARCH-QA-01` complete (sidecar gates pass).
- [ ] `ARCH-QA-02` complete (Unity EditMode gates pass).
- [ ] `ARCH-E2E-01` complete (Case A-D evidence archived).

## 8. Latest Run Record
- Date: `2026-03-01`
- Sidecar focused gate: `npm run test:phase-d:qa` -> `44 passed / 0 failed`
- Sidecar full gate: `npm test` -> `157 passed / 0 failed`
- Unity gate: pending in Unity Test Runner environment.
