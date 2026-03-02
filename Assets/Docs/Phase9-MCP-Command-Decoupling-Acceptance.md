# Phase 9 MCP Command Decoupling Acceptance (R11-CLOSE Baseline)

## 1. Scope
- This acceptance document freezes the screenshot stabilization closure baseline.
- It closes:
  - `R11-CLOSE-ASSET-01`
  - `R11-CLOSE-QA-01`
  - `R11-CLOSE-QA-02`
  - `R11-CLOSE-E2E-01`
- Hard guards remain mandatory: OCC, dual-anchor validation, atomic rollback, structured error feedback.

## 2. Preconditions
1. Sidecar dependencies installed:
```bash
cd sidecar
npm install
```
2. Unity Editor connected and able to answer `unity/query/pull`.
3. R11 sidecar closure gates are green:
```bash
cd sidecar
node --test "tests/application/r11-*.test.js" "tests/application/mcp-tool-schema-minimal.test.js" "tests/domain/validators.capture-scene-screenshot.test.js" "tests/domain/validators.hit-test-ui-at-screen-point.test.js"
npm run gate:r11-command-boundary
```
4. Unity EditMode baseline compiles before E2E replay.

## 3. End-to-End Cases

### 3.1 Case A: Screenshot Stable Path (render_output only)
1. Confirm `capture_scene_screenshot` exists in `tools/list`.
2. Confirm tool schema exposes `capture_mode` as `["render_output"]`.
3. Call:
```json
{
  "view_mode": "game",
  "capture_mode": "render_output",
  "output_mode": "artifact_uri",
  "include_ui": true
}
```
4. Expected:
- `ok = true`
- `data.capture_mode_effective = "render_output"`
- `data.fallback_reason` is empty
- response contains `artifact_uri` or `image_base64`
- response contains valid `read_token`

### 3.2 Case B: Disabled Modes Fail-Closed
1. Call `capture_scene_screenshot` with:
```json
{
  "view_mode": "game",
  "capture_mode": "final_pixels"
}
```
2. Repeat with `capture_mode = "editor_view"`.
3. Expected:
- returns `E_CAPTURE_MODE_DISABLED`
- `recoverable = true`
- suggestion points to `capture_mode=render_output`
- request does not enter Unity high-risk screen-read path

### 3.3 Case C: UI Tree Is Primary UI Read Path
1. Call `get_ui_tree` with:
```json
{
  "ui_system": "ugui",
  "include_inactive": true,
  "include_components": true,
  "include_layout": true,
  "max_depth": 6
}
```
2. Expected:
- `ok = true`
- stable `Scene/Canvas/...` path(s) returned
- valid `read_token` returned

### 3.4 Case D: Hit-Test Is Explicitly Disabled
1. Call `hit_test_ui_at_screen_point`.
2. Expected:
- returns `E_COMMAND_DISABLED`
- `recoverable = true`
- suggestion points to `get_ui_tree + capture_scene_screenshot(render_output)`

### 3.5 Case E: Visual Chain Regression (Tree-First)
1. Call `get_ui_tree` first.
2. Then call `capture_scene_screenshot` with `capture_mode = "render_output"`.
3. Expected:
- query order remains tree-first
- both responses carry valid read tokens
- screenshot stays on render_output-only semantics

### 3.6 Case F: Artifact Cleanup
1. Capture with `output_mode = "artifact_uri"` repeatedly.
2. Place stale file older than retention under `Library/Codex/McpArtifacts`.
3. Trigger capture again.
4. Expected:
- stale file removed by janitor
- artifact count remains within cap

## 4. Mandatory Gates

### 4.1 Sidecar
```bash
cd sidecar
node --test "tests/application/mcp-tool-schema-minimal.test.js" "tests/application/r11-command-contract-snapshot.test.js"
node --test "tests/application/r11-command-modules-and-screenshot.test.js" "tests/application/r11-screenshot-route-and-feedback.test.js"
node --test "tests/domain/validators.capture-scene-screenshot.test.js" "tests/domain/validators.hit-test-ui-at-screen-point.test.js"
npm run gate:r11-command-boundary
```

### 4.2 Unity EditMode
- `UnityRagReadServiceScreenshotTests`
- `UnityRagReadServiceUiTreeTests`
- `UnityVisualReadChainTests`
- `SidecarContractsExtensibilityDtoTests`
- `SidecarContractsSnapshotTests`
- Existing R10/R9 baseline suites remain green

### 4.3 Script Baseline
1. `sidecar/scripts/diagnose-capture.js` must only orchestrate:
   - `capture_scene_screenshot(render_output)`
   - `get_ui_tree`
2. `sidecar/scripts/verify-final-pixels-mode.ps1` must not exist.

## 5. Closure Checklist
1. tools/list and runtime behavior are consistent:
   - `capture_scene_screenshot`: render_output-only execution semantics
   - `hit_test_ui_at_screen_point`: disabled semantics
2. Legacy unstable screenshot mode success criteria removed from docs/tests.
3. No active L3 screen-read mapping path for final/editor capture remains.
4. Script index and acceptance docs match implementation.

## 6. Exit Criteria
1. R11 sidecar closure tests and guards are green.
2. Unity EditMode closure tests are green.
3. E2E verification confirms:
   - render_output success path
   - final/editor disabled path
   - hit_test disabled path
   - tree-first visual chain
4. No dual implementation left for removed high-risk screenshot paths.

## 7. Sign-off Checklist
- [ ] Sidecar R11-CLOSE test set green.
- [ ] Unity EditMode R11-CLOSE test set green.
- [ ] `diagnose-capture.js` output matches render_output baseline.
- [ ] Disabled modes return stable `E_CAPTURE_MODE_DISABLED`.
- [ ] hit_test returns stable `E_COMMAND_DISABLED`.
- [ ] Artifact cleanup behavior verified.
