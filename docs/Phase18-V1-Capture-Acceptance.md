# Phase18 V1-CAPTURE Acceptance

## 1. Scope
- This document is the acceptance entry for:
  - `R18-CAPTURE-E2E-00`
  - `R18-CAPTURE-QA-01`
  - `R18-CAPTURE-QA-02`
  - `R18-CAPTURE-E2E-01`
- It covers V1-CAPTURE closure from three parallel tracks:
  - overlay structural diagnostics baseline (`get_ui_overlay_report`)
  - screenshot and evidence integration (`render_output`, `visual_evidence`, volume control)
  - write-operation receipt and composite mode governance (flag, fuse, busy guard)

## 2. Success Criteria
1. Capture-related Sidecar focused gate (`test:r18:qa`) is green.
2. Full Sidecar regression (`npm test`) stays green after V1-CAPTURE.
3. Unity capture-related EditMode suites compile and pass.
4. End-to-end acceptance cases in this document are reproducible with auditable evidence.
5. Composite mode remains fail-closed when any required flag or runtime condition is not satisfied.

## 3. Preconditions
1. Sidecar dependencies are installed:
```bash
cd sidecar
npm install
```
2. Unity project opens and script compilation is complete.
3. Sidecar endpoint is reachable at `http://127.0.0.1:46321`.
4. Evidence root exists: `Assets/Docs/evidence/phase18/<yyyy-mm-dd>/`.

## 4. E2E Case Catalog (R18-CAPTURE-E2E-00)

### 4.1 Case IDs (Frozen)
- `P18-A-OVERLAY-001`: `get_ui_overlay_report` returns stable overlay coverage summary and `recommended_capture_mode`.
- `P18-A-FEEDBACK-001`: capture recommendation text is deterministic when overlay coverage is high.
- `P18-B-DIAG-001`: one-shot diagnosis script outputs `get_ui_tree + render_output + get_ui_overlay_report + validate_ui_layout`.
- `P18-B-EVIDENCE-001`: `capture_scene_screenshot` response contains `visual_evidence` field (nullable but contract-stable).
- `P18-B-RECEIPT-001`: write response includes `write_receipt` with diff/summary payload.
- `P18-B-CONSOLE-001`: write receipt includes bounded `console_snapshot`.
- `P18-B-SIZE-001`: oversized inline base64 is downgraded to artifact path with clear reason.
- `P18-C-FLAG-001`: `capture_mode=composite` is rejected with `E_CAPTURE_MODE_DISABLED` when flags are off.
- `P18-C-FUSE-001`: composite fuse triggers after continuous failures and auto-probes recovery.
- `P18-C-BUSY-001`: concurrent composite requests return `E_COMPOSITE_BUSY`.
- `P18-D-CLONE-001`: EditMode temp-scene clone path produces output without dirtying active scene.
- `P18-D-CLEANUP-001`: interrupted composite flow leaves no temp-scene residue.
- `P18-E-QA-SIDECAR-001`: Sidecar gates remain green.
- `P18-E-QA-UNITY-001`: Unity EditMode capture suites remain green.
- `P18-E-E2E-001`: all mandatory evidence archived and traceable.

### 4.2 Evidence Naming Convention (Frozen)
- `case-a-overlay-report.json`
- `case-a-feedback.json`
- `case-b-diagnose-capture-output.txt`
- `case-b-capture-response.json`
- `case-b-write-receipt.json`
- `case-b-console-snapshot.json`
- `case-b-size-control.json`
- `case-c-flag-disabled.json`
- `case-c-fuse-sequence.txt`
- `case-c-busy-guard.json`
- `case-d-editmode-composite.json`
- `case-d-temp-scene-cleanup.txt`
- `case-e-test-r18-qa.txt`
- `case-e-test-full.txt`
- `case-e-unity-editmode-results.xml` (optional CLI output)

## 5. Automated Gates

### 5.1 R18-CAPTURE-QA-01 Sidecar Gates
Focused gate:
```bash
cd sidecar
npm run test:r18:qa
```

Full regression:
```bash
cd sidecar
npm test
```

Expected:
- all tests pass
- capture contracts remain stable (`overlay_report`, `visual_evidence`, `write_receipt`, `composite guard/fuse`)

### 5.2 R18-CAPTURE-QA-02 Unity Gates
Run capture-related EditMode suites in Unity Test Runner:
- `UnityRagReadServiceScreenshotTests`
- `UnityVisualReadChainTests`
- `UiOverlayReportReadServiceTests` (or final renamed suite)
- `WriteReceiptServiceTests` (or final renamed suite)

Optional Unity CLI batch command:
```powershell
$env:UNITY_EXE = "C:\\Program Files\\Unity\\Hub\\Editor\\<version>\\Editor\\Unity.exe"
& $env:UNITY_EXE `
  -batchmode -nographics -quit `
  -projectPath "D:\\csgo\\csgoToolV02\\UnityAI" `
  -runTests -testPlatform EditMode `
  -testResults "Assets/Docs/evidence/phase18/<yyyy-mm-dd>/case-e-unity-editmode-results.xml"
```

## 6. End-to-End Acceptance Path (R18-CAPTURE-E2E-01)

### Case A: Overlay Structural Baseline
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/get_ui_overlay_report \
  -H "Content-Type: application/json" \
  -d "{\"scope\":{\"root_path\":\"Scene/Canvas\"},\"max_nodes\":256}"
```
Expected:
- response contains `overlay_canvases`, `overlay_total_coverage_percent`, `recommended_capture_mode`

### Case B: Diagnostic Fusion and Receipt
```bash
cd sidecar
node scripts/diagnose-capture.js
```
Expected:
- merged report includes `get_ui_tree + render_output + get_ui_overlay_report + validate_ui_layout`

Write + receipt check:
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/set_ui_properties \
  -H "Content-Type: application/json" \
  -d "{\"based_on_read_token\":\"<READ_TOKEN>\",\"updates\":[{\"path\":\"<TARGET_PATH>\",\"props\":{\"alpha\":0.9}}]}"
```
Expected:
- write response includes `write_receipt`
- receipt includes bounded `console_snapshot`

### Case C: Composite Governance
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/capture_scene_screenshot \
  -H "Content-Type: application/json" \
  -d "{\"capture_mode\":\"composite\",\"output_mode\":\"inline_base64\"}"
```
Expected:
- when flag disabled: `E_CAPTURE_MODE_DISABLED`
- when enabled and healthy: `capture_mode_effective=composite`
- on failure streak: fuse downgrade + `COMPOSITE_FUSED`

## 7. Case Status Matrix
| Case ID | Status | Evidence |
|---|---|---|
| P18-A-OVERLAY-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-a-overlay-report.json` |
| P18-A-FEEDBACK-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-a-feedback.json` |
| P18-B-DIAG-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-b-diagnose-capture-output.txt` |
| P18-B-EVIDENCE-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-b-capture-response.json` |
| P18-B-RECEIPT-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-b-write-receipt.json` |
| P18-B-CONSOLE-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-b-console-snapshot.json` |
| P18-B-SIZE-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-b-size-control.json` |
| P18-C-FLAG-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-c-flag-disabled.json` |
| P18-C-FUSE-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-c-fuse-sequence.txt` |
| P18-C-BUSY-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-c-busy-guard.json` |
| P18-D-CLONE-001 | OPTIONAL_NOT_RUN | `N/A (optional evidence for this round)` |
| P18-D-CLEANUP-001 | OPTIONAL_NOT_RUN | `N/A (optional evidence for this round)` |
| P18-E-QA-SIDECAR-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/case-e-test-r18-qa.txt` |
| P18-E-QA-UNITY-001 | PASS | `Unity Test Runner manual run all green (XML export optional and omitted)` |
| P18-E-E2E-001 | PASS | `Assets/Docs/evidence/phase18/2026-03-03/` |

## 8. Evidence Checklist
Store artifacts under:
- `Assets/Docs/evidence/phase18/<yyyy-mm-dd>/`

Required:
1. Sidecar gate outputs (`npm run test:r18:qa`, `npm test`).
2. Unity Test Runner outputs for capture-related suites (XML optional; manual runner pass summary acceptable).
3. Case A/B/C (and D when enabled) command outputs.
4. Receipt evidence (`write_receipt`, `console_snapshot`) and visual evidence field snapshot.
5. Failure triage + rerun notes for any non-green run.

## 9. Sign-off
- [x] `R18-CAPTURE-E2E-00` complete (case catalog and evidence naming frozen)
- [x] `R18-CAPTURE-E2E-01` complete (all mandatory acceptance cases replayed with archived evidence)

## 10. Latest Run Record
- Date: `2026-03-03`
- Focused sidecar gate: `npm --prefix sidecar run test:r18:qa` -> `pass 64 / fail 0` (see `Assets/Docs/evidence/phase18/2026-03-03/case-e-test-r18-qa.txt`)
- Sidecar full gate: `npm --prefix sidecar test` -> `pass 274 / fail 0` (see `Assets/Docs/evidence/phase18/2026-03-03/case-e-test-full.txt`)
- Unity gate: `PASS` (manual Unity Test Runner run all green; optional XML not exported)
- E2E evidence path: `Assets/Docs/evidence/phase18/2026-03-03/`
