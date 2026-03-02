# Phase16 Hybrid Architecture Acceptance

## 1. Scope
- This document is the acceptance entry for:
  - `R16-HYBRID-QA-01`
  - `R16-HYBRID-QA-02`
  - `R16-HYBRID-E2E-01`
- It freezes the Phase E baseline for the hybrid architecture:
  - primitives (`create_object`, `set_parent`, `set_sibling_index`, ...)
  - generalized layer (`set_serialized_property`, `get_serialized_property_tree`)
  - specialist layer (`validate_ui_layout` with repair plan)

## 2. Success Criteria
1. Sidecar regression gates are green for write/read/visibility/contract.
2. Unity EditMode suites for atomic rollback and serialized property pipelines are present and runnable.
3. E2E path is reproducible in one document and covers primitive + generalized + specialist flows.
4. Main architecture index and project guide both point to this document.

## 3. Preconditions
1. Sidecar dependencies installed:
```bash
cd sidecar
npm install
```
2. Unity project opens successfully and finishes compile.
3. Sidecar endpoint is reachable at `http://127.0.0.1:46321`.
4. A test scene is available with at least one UI root (`Canvas`) and one child object.

## 4. Automated Gates

### 4.1 R16-HYBRID-QA-01 Sidecar Gates
Run focused Phase E QA gate:
```bash
cd sidecar
npm run test:r16:qa
```

Run wire guard:
```bash
cd sidecar
npm run gate:r16-wire
```

Run full sidecar regression before release sign-off:
```bash
cd sidecar
npm test
```

Expected:
- all tests pass
- schema and validator parity is stable
- wire contract guard stays green
- specialist diagnose script tests pass

### 4.2 R16-HYBRID-QA-02 Unity EditMode Gates
Run these suites in Unity Test Runner (`EditMode`):
- `AtomicSafeHighPriorityActionTests`
- `PrimitiveActionCoverageTests`
- `SerializedPropertyActionHandlerTests`
- `SerializedPropertyTreeReadServiceTests`
- `McpVisualActionContextTests`
- `UnitySetUiPropertiesMappingTests`
- `UnityUiLayoutValidatorTests`
- `SidecarContractsSnapshotTests`

Expected:
- compile succeeds
- all listed suites pass
- rollback-related failures return stable error codes (`E_COMPOSITE_ROLLBACK_INCOMPLETE`, etc.)
- object-reference mapping failures return stable error codes (`E_OBJECT_REF_NOT_FOUND`, `E_OBJECT_REF_TYPE_MISMATCH`)

## 5. End-to-End Acceptance Path (R16-HYBRID-E2E-01)

### Case A: Primitive Layer (`set_parent`)
1. Read anchors and read token:
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/get_ui_tree ^
  -H "Content-Type: application/json" ^
  -d "{\"scope\":{\"root_path\":\"Scene/Canvas\"},\"max_depth\":4}"
```
2. Pick one child as `target_anchor`, one container as `parent_anchor`, then dry-run:
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/apply_visual_actions ^
  -H "Content-Type: application/json" ^
  -d "{\"based_on_read_token\":\"<READ_TOKEN>\",\"write_anchor\":{\"object_id\":\"<WRITE_ID>\",\"path\":\"<WRITE_PATH>\"},\"actions\":[{\"type\":\"set_parent\",\"target_anchor\":{\"object_id\":\"<TARGET_ID>\",\"path\":\"<TARGET_PATH>\"},\"parent_anchor\":{\"object_id\":\"<PARENT_ID>\",\"path\":\"<PARENT_PATH>\"},\"action_data\":{\"world_position_stays\":true}}],\"dry_run\":true}"
```
3. Expected:
- HTTP 200
- `ok=true`
- action result `success=true`
- no schema or anchor errors

### Case B: Generalized Read + Write (`get_serialized_property_tree` + `set_serialized_property`)
1. Query component property tree:
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/get_serialized_property_tree ^
  -H "Content-Type: application/json" ^
  -d "{\"target_anchor\":{\"object_id\":\"<TARGET_ID>\",\"path\":\"<TARGET_PATH>\"},\"component_selector\":{\"component_assembly_qualified_name\":\"UnityEngine.RectTransform, UnityEngine.CoreModule\",\"component_index\":0},\"depth\":1,\"page_size\":32}"
```
2. Apply a dry-run patch:
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/set_serialized_property ^
  -H "Content-Type: application/json" ^
  -d "{\"based_on_read_token\":\"<READ_TOKEN>\",\"write_anchor\":{\"object_id\":\"<WRITE_ID>\",\"path\":\"<WRITE_PATH>\"},\"target_anchor\":{\"object_id\":\"<TARGET_ID>\",\"path\":\"<TARGET_PATH>\"},\"component_selector\":{\"component_assembly_qualified_name\":\"UnityEngine.RectTransform, UnityEngine.CoreModule\",\"component_index\":0},\"patches\":[{\"property_path\":\"m_AnchoredPosition.x\",\"value_kind\":\"float\",\"float_value\":12.0}],\"dry_run\":true}"
```
3. Expected:
- query response includes `nodes`, `returned_count`, `truncated`
- write response goes through `apply_visual_actions` chain and returns `ok=true`
- invalid object reference payload should return stable errors (`E_OBJECT_REF_NOT_FOUND` or `E_OBJECT_REF_TYPE_MISMATCH`)

### Case C: Specialist Layer (`validate_ui_layout` repair plan)
1. Run specialist diagnosis script:
```bash
cd sidecar
npm run diagnose:ui:specialist -- --base-url http://127.0.0.1:46321 --strict
```
2. Or call endpoint directly:
```bash
curl -sS -X POST http://127.0.0.1:46321/mcp/validate_ui_layout ^
  -H "Content-Type: application/json" ^
  -d "{\"scope\":{\"root_path\":\"Scene/Canvas\"},\"include_repair_plan\":true,\"max_repair_suggestions\":6,\"repair_style\":\"balanced\"}"
```
3. Expected:
- `data.specialist_summary` exists
- `data.repair_plan` exists when requested
- `data.repair_plan_generated_by` is `unity` or `sidecar`
- recommended action types are compatible with current action catalog

## 6. Evidence Checklist
Store acceptance artifacts under:
- `Assets/Docs/evidence/phase16/<yyyy-mm-dd>/`

Required artifacts:
1. Sidecar logs for `npm run test:r16:qa`, `npm run gate:r16-wire`, `npm test`.
2. Unity Test Runner screenshot/log for listed EditMode suites.
3. E2E command output snapshots for Case A/B/C.
4. `diagnose-ui-specialist-report.json`.
5. Triage notes for any failure and rerun evidence.

## 7. Sign-off
- [ ] `R16-HYBRID-QA-01` complete (sidecar gates pass)
- [ ] `R16-HYBRID-QA-02` complete (Unity EditMode gates pass)
- [ ] `R16-HYBRID-E2E-01` complete (Case A/B/C evidence archived)

## 8. Latest Run Record
- Date: `2026-03-02`
- Sidecar focused gate: `npm run test:r16:qa` -> pending this document release run
- Sidecar full gate: `npm test` -> `221 passed / 0 failed`
- Wire guard: `npm run gate:r16-wire` -> pass (non-strict mode may include atomic coverage warnings)
- Unity gate: pending in Unity Test Runner environment
