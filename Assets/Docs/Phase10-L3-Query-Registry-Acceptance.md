# Phase 10 L3 Query Registry Acceptance (R12 Baseline)

> Note: Phase D closure (`ARCH-ASSET-01/ARCH-QA-01/ARCH-QA-02/ARCH-E2E-01`) is tracked in `Assets/Docs/Phase11-Architecture-Decoupling-Acceptance.md`.

## 1. Scope
- This acceptance document freezes the R12 Query Registry baseline.
- It closes:
  - `R12-L3-06`
  - `R12-QA-01`
  - `R12-L2-03`
  - `R12-E2E-01`
- Hard guards remain mandatory: OCC, dual-anchor validation, screenshot closure (`render_output` only), disabled command semantics.

## 2. Preconditions
1. Sidecar dependencies installed:
```bash
cd sidecar
npm install
```
2. Unity Editor project compiles and can process `unity/query/pull` + `unity/query/report`.
3. R11-CLOSE baseline is green:
```bash
cd sidecar
node --test "tests/application/r11-*.test.js" "tests/application/mcp-tool-schema-minimal.test.js"
node --test "tests/domain/validators.capture-scene-screenshot.test.js" "tests/domain/validators.hit-test-ui-at-screen-point.test.js"
```
4. R12 code landed:
- `ConversationController` read-query dispatch is registry-only.
- Query handlers are split under `Assets/Editor/Codex/Infrastructure/Queries/Handlers/`.

## 3. Mandatory Automated Gates

### 3.1 Sidecar Gates
```bash
cd sidecar
node --test "tests/application/*command*.test.js" "tests/application/*schema*.test.js"
node --test "tests/application/r12-tool-visibility-freeze.test.js" "tests/application/r12-tool-registry-consistency.test.js"
node --test "tests/application/r11-command-contract-snapshot.test.js" "tests/application/mcp-tool-schema-minimal.test.js"
node --test "tests/domain/contracts.phase6-freeze.test.js"
```

### 3.2 Unity EditMode Gates
- `UnityQueryRegistryTests`
- `UnityQueryRegistryDispatchTests`
- `UnityQueryControllerClosureTests`
- `UnityRagReadServiceScreenshotTests`
- `UnityRagReadServiceUiTreeTests`
- `UnityVisualReadChainTests`
- Existing R10/R11/R9 baseline suites remain green.

## 4. End-to-End Cases

### 4.1 Case A: Controller Registry-Only Dispatch
1. Verify `ConversationController.ExecutePulledReadQueryAsync` dispatches via `_unityQueryRegistry.DispatchAsync(...)`.
2. Verify controller does not include per-query `if/switch` branches for:
- `list_assets_in_folder`
- `get_scene_roots`
- `find_objects_by_component`
- `query_prefab_info`
- `capture_scene_screenshot`
- `get_ui_tree`
- `hit_test_ui_at_screen_point`
3. Expected:
- registry-only dispatch path
- unsupported type returns `E_UNSUPPORTED_QUERY_TYPE`.

### 4.2 Case B: Registry Coverage Is Complete
1. Build default registry.
2. Expected handlers exist for:
- `list_assets_in_folder`
- `get_scene_roots`
- `find_objects_by_component`
- `query_prefab_info`
- `capture_scene_screenshot`
- `get_ui_tree`
- `hit_test_ui_at_screen_point` (disabled semantics handler)

### 4.3 Case C: Main-Thread Gate Is Enforced by Execution Context
1. Execute registry dispatch for one migrated command (for example `list_assets_in_folder`).
2. Expected:
- handler runs through execution-context main-thread gate
- payload request_id backfills when response request_id is empty
- error mapping remains standardized.

### 4.4 Case D: L2 Tools/Contracts Consistency
1. Verify `tools/list` names match `ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names`.
2. Verify disabled tool semantics remain explicit:
- `hit_test_ui_at_screen_point` exposes disabled wording / `E_COMMAND_DISABLED`.
3. Verify `mcpServer` does not reintroduce manual tool-name `switch`.

### 4.5 Case E: Read Command Runtime Compatibility
1. Execute read routes through sidecar command registry:
- `list_assets_in_folder`
- `get_scene_roots`
- `find_objects_by_component`
- `query_prefab_info`
- `capture_scene_screenshot`
- `get_ui_tree`
2. Expected:
- successful commands return stable envelopes
- `hit_test_ui_at_screen_point` returns disabled envelope
- screenshot closure behavior does not regress (`render_output` only execution semantics).

### 4.6 Case F: Onboarding Path Validation (Single Path)
1. Simulate adding one new read command using registry workflow.
2. Expected minimal file delta:
- new handler file
- registry bootstrap registration line
- test file/section
3. Expected:
- no new business branch in `ConversationController`.

## 5. Closure Checklist
1. `ConversationController` no longer expands by query-type branch growth.
2. Query handlers are modular and explicitly registered.
3. Registry dispatch errors remain standardized and LLM-friendly.
4. Sidecar tools/list and contract freeze remain consistent.
5. R11 screenshot closure constraints remain enforced.

## 6. Exit Criteria
1. All sidecar gates in Section 3.1 are green.
2. Unity EditMode gates in Section 3.2 are green.
3. Case A-F evidence is attached (test output and key logs).
4. No rollback to manual dispatcher branches in L2/L3.

## 7. Sign-Off Checklist
- [ ] Sidecar R12 command/schema consistency tests are green.
- [ ] Unity EditMode R12 registry tests are green.
- [ ] Controller registry-only dispatch is verified.
- [ ] Default registry includes all R12 read handlers.
- [ ] tools/list and contracts remain consistent.
- [ ] Screenshot closure behavior remains unchanged.
- [ ] New read command onboarding path validated without controller branch edits.
