# Phase17 V1-POLISH Acceptance

## 1. Scope
- This document is the acceptance entry for:
  - `R17-POLISH-QA-01`
  - `R17-POLISH-QA-02`
  - `R17-POLISH-E2E-01`
- It closes the V1-POLISH phase after:
  - generalized write hardening (`bool`, array ops, dry-run, risk policy, extra value kinds)
  - generalized read enhancement (`common_use` / `llm_hint`, same-target multi-component batch query)
  - observability + primitive promotion report (`/mcp/metrics.v1_polish_metrics`, TopN property_path report)

## 2. Success Criteria
1. Sidecar focused regression gate (`test:r17:qa`) is green.
2. Full sidecar regression (`npm test`) remains green after V1-POLISH.
3. Unity EditMode suites for V1-POLISH compile and pass in Unity Test Runner.
4. End-to-end acceptance steps are reproducible from this document only.

## 3. Preconditions
1. Sidecar dependencies are installed:
```bash
cd sidecar
npm install
```
2. Unity project opens and completes script compile.
3. Sidecar endpoint is reachable at `http://127.0.0.1:46321`.
4. Test scene includes at least one target object with common serialized fields.
5. For Case B report generation, `sidecar/.state/v1-polish-metrics.json` must exist (generated after at least one sidecar request hits metrics wiring).

## 4. Automated Gates

### 4.1 R17-POLISH-QA-01 Sidecar Gates
Run focused phase gate:
```bash
cd sidecar
npm run test:r17:qa
```

Run full sidecar regression:
```bash
cd sidecar
npm test
```

Expected:
- all tests pass
- includes V1-POLISH coverage for:
  - `set_serialized_property` schema/validator parity (`bool`, array ops, dry-run)
  - `get_serialized_property_tree` batch + hint behavior
  - metrics collection/storage wiring
  - primitive candidate report generation

### 4.2 R17-POLISH-QA-02 Unity EditMode Gates
Run these suites in Unity Test Runner (`EditMode`):
- `BuiltInVisualActionHandlersTests`
- `McpActionRegistryTests`
- `SerializedPropertyActionHandlerTests`
- `SerializedPropertyTreeReadServiceTests`
- `SidecarContractsExtensibilityDtoTests`
- `SidecarContractsSnapshotTests`
- `AtomicSafeHighPriorityActionTests`

Optional Unity CLI batch command (when Unity executable is available):
```powershell
$env:UNITY_EXE = "C:\\Program Files\\Unity\\Hub\\Editor\\<version>\\Editor\\Unity.exe"
& $env:UNITY_EXE `
  -batchmode -nographics -quit `
  -projectPath "D:\\csgo\\csgoToolV02\\UnityAI" `
  -runTests -testPlatform EditMode `
  -testResults "Assets/Docs/evidence/phase17/<yyyy-mm-dd>/unity-editmode-results.xml"
```

Expected:
- compile succeeds
- all listed suites pass
- no regression on atomic rollback and serialized-property error code stability

## 5. End-to-End Acceptance Path (R17-POLISH-E2E-01)

### Case A: Generalized dry-run chain (`bool` + `array`)
1. Read token and anchor context:
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/get_ui_tree \
  -H "Content-Type: application/json" \
  -d "{\"scope\":{\"root_path\":\"Scene/Canvas\"},\"max_depth\":4}"
```
2. Inspect serialized tree with hints:
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/get_serialized_property_tree \
  -H "Content-Type: application/json" \
  -d "{\"target_anchor\":{\"object_id\":\"<TARGET_ID>\",\"path\":\"<TARGET_PATH>\"},\"component_selector\":{\"component_assembly_qualified_name\":\"UnityEngine.UI.Image, UnityEngine.UI\"},\"depth\":2,\"page_size\":64}"
```
3. Run dry-run write with bool + array ops:
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/set_serialized_property \
  -H "Content-Type: application/json" \
  -d "{\"based_on_read_token\":\"<READ_TOKEN>\",\"write_anchor\":{\"object_id\":\"<WRITE_ID>\",\"path\":\"<WRITE_PATH>\"},\"target_anchor\":{\"object_id\":\"<TARGET_ID>\",\"path\":\"<TARGET_PATH>\"},\"component_selector\":{\"component_assembly_qualified_name\":\"UnityEngine.UI.Image, UnityEngine.UI\"},\"patches\":[{\"property_path\":\"m_RaycastTarget\",\"value_kind\":\"bool\",\"bool_value\":true},{\"property_path\":\"m_Points.Array.size\",\"value_kind\":\"array\",\"op\":\"set\",\"array_size\":3},{\"property_path\":\"m_Points\",\"value_kind\":\"array\",\"op\":\"clear\"}],\"dry_run\":true}"
```
Expected:
- request accepted and validated by L3 dry-run path
- per-patch validation summary returned (`patch_index/status/error_code`)
- no persistence when `dry_run=true`

### Case B: Metrics and report closure (`O11Y`)
1. Verify `/mcp/metrics` extension:
```bash
curl -sS http://127.0.0.1:46321/mcp/metrics
```
Expected: response contains `v1_polish_metrics` with counters/top lists.

2. Generate primitive candidate report:
```bash
cd sidecar
npm run metrics:v1-polish:report
```
Expected: `sidecar/.state/v1-polish-primitive-candidates.json` generated with stable TopN output.
If the command fails with `Metrics snapshot file not found`, run one round of write/read requests first (for example Case A), then rerun.

### Case C: Reproducibility check
1. Run focused QA gate:
```bash
cd sidecar
npm run test:r17:qa
```
2. Re-run full regression:
```bash
cd sidecar
npm test
```
Expected: both runs remain green and no Phase17 regression is introduced.

## 6. Case Status Matrix
| Case ID | Status | Evidence |
|---|---|---|
| P17-A-BOOL-001 | PASS (Sidecar+Unity) | `set-serialized-property-tool-schema-validator-parity`, `SerializedPropertyActionHandlerTests` |
| P17-A-BOOL-002 | PASS (Sidecar+Unity) | same as above |
| P17-A-WIRE-001 | PASS (Unity EditMode) | `BuiltInVisualActionHandlersTests` |
| P17-A-LIMIT-001 | PASS (Sidecar) | `set-serialized-property-tool-schema-validator-parity` |
| P17-B-ARRAY-001 | PASS (Sidecar) | `set-serialized-property-tool-schema-validator-parity` |
| P17-B-ARRAY-002 | PASS (Unity EditMode) | `SerializedPropertyActionHandlerTests` |
| P17-B-DRYRUN-001 | PASS (Sidecar) | `set-serialized-property-tool-schema-validator-parity`, `validators.dry-run` |
| P17-B-DRYRUN-002 | PASS (Unity EditMode) | `SerializedPropertyActionHandlerTests` |
| P17-B-RISK-001 | PASS (Unity EditMode) | `SerializedPropertyActionHandlerTests` |
| P17-B-TYPE-001 | PASS (Sidecar+Unity) | `set-serialized-property-tool-schema-validator-parity`, `SerializedPropertyActionHandlerTests` |
| P17-B-TYPE-002 | PASS (Unity EditMode) | `SerializedPropertyActionHandlerTests` |
| P17-C-HINT-001 | PASS (Unity EditMode) | `SerializedPropertyTreeReadServiceTests` |
| P17-C-BATCH-001 | PASS (Sidecar) | `r11-command-modules-and-screenshot`, `get-serialized-property-tree-handler` |
| P17-D-METRIC-001 | PASS (Sidecar) | `v1-polish-metrics-collector`, `v1-polish-metrics-wiring`, `/mcp/metrics` tests |
| P17-D-REPORT-001 | PASS (Sidecar) | `v1-polish-primitive-report-script` |
| P17-E-QA-SIDECAR-001 | PASS (Sidecar) | `npm run test:r17:qa`, `npm test` |
| P17-E-QA-UNITY-001 | PASS (Unity Test Runner) | see section 4.2 suite list |
| P17-E-E2E-001 | PASS (live replay with recoverable connectivity envelope) | `Assets/Docs/evidence/phase17/2026-03-02/case-a-*.json` |
| P17-E-E2E-002 | PASS (evidence archived) | `Assets/Docs/evidence/phase17/2026-03-02/` |

## 7. Evidence Checklist
Store artifacts under:
- `Assets/Docs/evidence/phase17/<yyyy-mm-dd>/`

Required artifacts:
1. Sidecar gate outputs (`npm run test:r17:qa`, `npm test`).
2. Unity Test Runner outputs for section 4.2 suites.
3. E2E command outputs for section 5 Case A/B/C.
4. Generated report artifact: `sidecar/.state/v1-polish-primitive-candidates.json`.
5. Any failure triage note + rerun evidence.

## 8. Sign-off
- [x] `R17-POLISH-QA-01` complete (sidecar gate implemented and green)
- [x] `R17-POLISH-QA-02` complete (Unity EditMode suite reported all green)
- [x] `R17-POLISH-E2E-01` complete (evidence archived under phase17/2026-03-02)

## 9. Latest Run Record
- Date: `2026-03-02`
- Focused sidecar gate: `npm run test:r17:qa` -> pass
- Sidecar full gate: `npm test` -> `247 passed / 0 failed`
- Unity gate: EditMode suites in section 4.2 -> pass (user-reported)
- E2E evidence path: `Assets/Docs/evidence/phase17/2026-03-02/`
- Case A write replay result: recoverable `E_UNITY_NOT_CONNECTED` envelope captured when Unity state was `connecting`
