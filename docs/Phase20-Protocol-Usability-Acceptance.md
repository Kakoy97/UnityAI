# Phase20 Protocol Usability Acceptance

## 1. Scope
- This document is the acceptance entry for:
  - `R20-UX-QA-01`
  - `R20-UX-QA-02`
  - `R20-UX-E2E-01`
  - `R20-UX-HF-01`
  - `R20-UX-HF-02`
  - `R20-UX-HF-03`
  - `R20-UX-GOV-07`
  - `R20-UX-GOV-08`
- It closes Phase E of `V2-PROTOCOL` and freezes repeatable acceptance paths for:
  - contract discoverability
  - machine-fixable error feedback
  - preflight normalization
  - retry governance
  - strict-envelope hotfix closure (Phase F)
  - governance baseline metrics (Phase G partial)
  - preflight/dry_run lifecycle closure (Phase G partial)

## 2. Success Criteria
1. Sidecar focused gate (`test:r20:qa`) is green.
2. Sidecar full regression (`npm test`) stays green.
3. Unity EditMode protocol-chain suites compile and pass.
4. E2E case outputs are archived with auditable evidence naming.
5. Retry governance behavior is deterministic:
  - duplicate failed retries are blocked
  - stale snapshot keeps one-shot retry guidance only
6. Invalid Unity action envelopes do not stay in silent pending until lease timeout.
7. Governance baseline report can compare before/after KPI snapshots from `/mcp/metrics`.
8. `preflight_validate_write_payload` is stable and `dry_run` is documented as deprecated compatibility alias.

## 3. Preconditions
1. Sidecar dependencies installed:
```bash
cd sidecar
npm install
```
2. Unity project opens and script compilation is complete.
3. Sidecar endpoint reachable at `http://127.0.0.1:46321`.
4. Evidence root exists: `Assets/Docs/evidence/phase20/<yyyy-mm-dd>/`.

## 4. E2E Case Catalog (Frozen)

### 4.1 Case IDs
- `P20-A-CONTRACT-001`: `get_write_contract_bundle` returns envelope contract + minimal template in-budget.
- `P20-A-CONTRACT-002`: `get_action_schema` includes `minimal_valid_payload_template`.
- `P20-A-CONTRACT-003`: `get_tool_schema` includes `required_sequence` and canonical examples.
- `P20-B-FIX-001`: anchor schema error returns `schema_source=get_tool_schema`.
- `P20-B-FIX-002`: anchor error returns `field_path/fix_kind/suggested_patch/corrected_payload`.
- `P20-B-FIX-003`: action_data schema error keeps action-schema compensation and no anchor auto-fix.
- `P20-C-PREFLIGHT-001`: `preflight_validate_write_payload` returns blocking errors + normalized payload.
- `P20-C-PREFLIGHT-002`: `dry_run` alias path keeps parity with preflight conclusions.
- `P20-C-NORMALIZE-001`: single-action missing `target_anchor` is auto-filled from `write_anchor`.
- `P20-C-NORMALIZE-002`: ambiguous/invalid anchor cases fail fast.
- `P20-D-RETRY-001`: duplicate retry fuse blocks repeated same payload+code in window.
- `P20-D-RETRY-002`: duplicate retry fuse is isolated by `thread_id`.
- `P20-D-RETRY-003`: stale snapshot feedback carries one-shot `retry_policy`.
- `P20-E-QA-SIDECAR-001`: sidecar focused gate remains green.
- `P20-E-QA-UNITY-001`: Unity protocol-chain EditMode suites remain green.
- `P20-E-E2E-001`: mandatory evidence set archived and traceable.
- `P20-F-HF-001`: invalid action envelope terminates with explicit failure (not max-runtime pending timeout).
- `P20-F-HF-002`: mutation action with valid `target_anchor` + malformed optional `parent_anchor` still succeeds (or fails fast with deterministic actionable code).
- `P20-F-HF-003`: hotfix evidence and regression notes archived.
- `P20-G-GOV-001`: governance baseline report captures before/after KPI deltas.
- `P20-H-LIFECYCLE-001`: preflight lifecycle is stable and tool schema includes dry_run migration guidance.

### 4.2 Evidence Naming Convention
- `case-a-get-write-contract-bundle.json`
- `case-a-get-action-schema-template.json`
- `case-a-get-tool-schema-sequence.json`
- `case-b-anchor-error-feedback.json`
- `case-b-action-data-error-feedback.json`
- `case-b-corrected-payload-retry.json`
- `case-c-preflight-normalized.json`
- `case-c-dry-run-alias-parity.json`
- `case-c-ambiguous-anchor-rejected.json`
- `case-d-retry-fuse-blocked.json`
- `case-d-stale-retry-policy.json`
- `case-e-test-r20-qa.txt`
- `case-e-test-full.txt`
- `case-e-unity-editmode-results.xml` (optional CLI export)
- `case-f-invalid-envelope-fast-fail.json`
- `case-f-optional-parent-anchor-compat.json`
- `case-f-hotfix-regression-notes.md`
- `case-g-metrics-before.json`
- `case-g-metrics-after.json`
- `case-g-governance-baseline-report.json`
- `case-h-preflight-tool-schema.json`
- `case-h-dry-run-alias-response.json`

## 5. Automated Gates

### 5.1 R20-UX-QA-01 Sidecar
Focused gate:
```bash
cd sidecar
npm run test:r20:qa
```

Full regression:
```bash
cd sidecar
npm test
```

### 5.2 R20-UX-QA-02 Unity
Run EditMode suites in Unity Test Runner:
- `UnityPhase6ClosureTests`
- `UnityVisualReadChainTests`
- `UnityVisualActionRegistryExecutorTests`
- `UnityErrorFeedbackReceiptTests`
- `SidecarContractsSnapshotTests`
- `UnityRuntimeRecoveryTests` (Phase F strict-envelope hotfix coverage)

Optional Unity CLI batch command:
```powershell
$env:UNITY_EXE = "C:\\Program Files\\Unity\\Hub\\Editor\\<version>\\Editor\\Unity.exe"
& $env:UNITY_EXE `
  -batchmode -nographics -quit `
  -projectPath "D:\\csgo\\csgoToolV02\\UnityAI" `
  -runTests -testPlatform EditMode `
  -testResults "Assets/Docs/evidence/phase20/<yyyy-mm-dd>/case-e-unity-editmode-results.xml"
```

## 6. End-to-End Acceptance Path (R20-UX-E2E-01)

### Case A: Contract Discoverability
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/get_write_contract_bundle \
  -H "Content-Type: application/json" \
  -d "{\"tool_name\":\"apply_visual_actions\",\"action_type\":\"rename_object\"}"
```

Expected:
- returns `write_envelope_contract`
- returns `minimal_valid_payload_template`
- returns budget metadata/truncation flag

### Case B: Machine-Fixable Error
Invoke one invalid write payload (missing action anchor) and collect error output.

Expected:
- anchor error returns `field_path`, `fix_kind`, `suggested_patch`
- when deterministic, returns `corrected_payload`

### Case C: Preflight + Normalization
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/preflight_validate_write_payload \
  -H "Content-Type: application/json" \
  -d "{\"tool_name\":\"apply_visual_actions\",\"payload\":{\"based_on_read_token\":\"<READ_TOKEN>\",\"write_anchor\":{\"object_id\":\"<ID>\",\"path\":\"Scene/Canvas/Panel\"},\"actions\":[{\"type\":\"rename_object\",\"action_data\":{\"name\":\"P20_Test\"}}]}}"
```

Expected:
- no Unity dispatch side effects
- returns normalized payload for deterministic anchor fill

### Case D: Retry Governance
Trigger repeated same-payload invalid writes in same thread.

Expected:
- second repeated failure in window is blocked by `E_DUPLICATE_RETRY_BLOCKED`
- stale snapshot returns retry policy with `allow_auto_retry=true` and `max_attempts=1`

### Case F: Strict Envelope Hotfix
Reproduce the historical rename loop case and capture both outcomes:
- invalid envelope path returns deterministic failure without staying `pending` until `E_JOB_MAX_RUNTIME_EXCEEDED`
- optional malformed `parent_anchor` does not block mutation action when `target_anchor` is complete

Expected:
- no silent pending loop
- terminal status available quickly (`failed` with actionable code or `succeeded`)

### Case G: Governance Baseline
Capture `/mcp/metrics` snapshots before and after replay run, then generate report:
```bash
npm --prefix sidecar run metrics:r20:governance -- \
  --before Assets/Docs/evidence/phase20/<yyyy-mm-dd>/case-g-metrics-before.json \
  --after Assets/Docs/evidence/phase20/<yyyy-mm-dd>/case-g-metrics-after.json \
  --output Assets/Docs/evidence/phase20/<yyyy-mm-dd>/case-g-governance-baseline-report.json
```

Expected:
- report contains KPI comparison for retry/convergence/timeout/token dimensions
- report schema is `r20_ux_governance_baseline_report.v1`

### Case H: Preflight Lifecycle Closure
Capture tool schema and one dry_run compatibility response.

Expected:
- `get_tool_schema(tool_name=preflight_validate_write_payload)` returns `lifecycle=stable`
- write-tool `dry_run` response contains alias deprecation guidance pointing to preflight tool

## 7. Case Status Matrix
| Case ID | Status | Evidence |
|---|---|---|
| P20-A-CONTRACT-001 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-a-get-write-contract-bundle.json` |
| P20-A-CONTRACT-002 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-a-get-action-schema-template.json` |
| P20-A-CONTRACT-003 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-a-get-tool-schema-sequence.json` |
| P20-B-FIX-001 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-b-anchor-error-feedback.json` |
| P20-B-FIX-002 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-b-corrected-payload-retry.json` |
| P20-B-FIX-003 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-b-action-data-error-feedback.json` |
| P20-C-PREFLIGHT-001 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-c-preflight-normalized.json` |
| P20-C-PREFLIGHT-002 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-c-dry-run-alias-parity.json` |
| P20-C-NORMALIZE-001 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-c-preflight-normalized.json` |
| P20-C-NORMALIZE-002 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-c-ambiguous-anchor-rejected.json` |
| P20-D-RETRY-001 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-d-retry-fuse-blocked.json` |
| P20-D-RETRY-002 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-d-retry-fuse-blocked.json` |
| P20-D-RETRY-003 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-d-stale-retry-policy.json` |
| P20-E-QA-SIDECAR-001 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-e-test-r20-qa.txt` |
| P20-E-QA-UNITY-001 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-e-unity-editmode-results.txt` |
| P20-E-E2E-001 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/` |
| P20-F-HF-001 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-f-invalid-envelope-fast-fail.json` |
| P20-F-HF-002 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-f-optional-parent-anchor-compat.json` |
| P20-F-HF-003 | PASS | `Assets/Docs/evidence/phase20/2026-03-03/case-f-hotfix-regression-notes.md` |
| P20-G-GOV-001 | PENDING | `Assets/Docs/evidence/phase20/<yyyy-mm-dd>/case-g-governance-baseline-report.json` |
| P20-H-LIFECYCLE-001 | PENDING | `Assets/Docs/evidence/phase20/<yyyy-mm-dd>/case-h-preflight-tool-schema.json` |

## 8. Evidence Checklist
Store artifacts under:
- `Assets/Docs/evidence/phase20/<yyyy-mm-dd>/`

Mandatory:
1. `case-e-test-r20-qa.txt` and `case-e-test-full.txt`.
2. Case A/B/C/D JSON outputs listed above.
3. Unity EditMode pass summary (XML optional; manual runner summary acceptable).
4. Rerun notes for any failed attempt before final pass.
5. Phase F hotfix evidence (`case-f-*`) and reproduction notes.
6. Governance baseline artifacts (`case-g-*`).
7. Lifecycle closure artifacts (`case-h-*`).

## 9. Sign-off
- [x] `R20-UX-QA-01` complete (sidecar QA gate implemented and green)
- [x] `R20-UX-QA-02` complete (Unity protocol-chain EditMode rerun completed)
- [x] `R20-UX-E2E-01` complete (evidence archived: 2026-03-03)
- [x] `R20-UX-HF-01` complete (invalid envelope fast-fail hotfix verified)
- [x] `R20-UX-HF-02` complete (optional parent anchor compatibility hotfix verified)
- [x] `R20-UX-HF-03` complete (hotfix regression tests passed)
- [ ] `R20-UX-GOV-07` complete (before/after governance baseline evidence archived)
- [ ] `R20-UX-GOV-08` complete (preflight stable + dry_run alias migration evidence archived)

## 10. Latest Run Record
- Date: `2026-03-03`
- Focused sidecar gate: `npm --prefix sidecar run test:r20:qa` -> `pass 60 / fail 0` ✓
- Sidecar full gate: `npm --prefix sidecar test` -> `pass 304 / fail 0` ✓
- Unity gate: `PASS` (manual run reported green by operator/Cursor)
- Evidence root: `Assets/Docs/evidence/phase20/2026-03-03/`
