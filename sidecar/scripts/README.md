# Sidecar Script Index (R16-HYBRID Baseline)

## Active Validation / Gate Scripts
- `mcp-job-runner.js`
- `mcp-stream-runner.js`
- `mcp-visual-anchor-regression.js`
- `step8-quality-gate.js`
- `r9-closure-guard.js`
- `r9-doc-index-guard.js`
- `r10-responsibility-guard.js`
- `r10-contract-snapshot-guard.js`
- `r10-doc-index-guard.js`
- `r11-command-boundary-guard.js`
- `r16-wire-guard.js`

## Utility Scripts
- `diagnose-capture.js`
- `diagnose-ui.js`
- `diagnose-ui-specialist.js`
- `generate-v1-polish-primitive-report.js`
- `replay-failed-report.js`
- `setup-cursor-mcp.js`
- `verify-mcp-setup.js`

## Cursor MCP Onboarding (R19-SU-A-02)
- Script mode:
  - `npm run mcp:setup-cursor -- --native http://127.0.0.1:46321`
  - `npm run mcp:verify -- --auto`
- MCP tool mode:
  - `setup_cursor_mcp` (native/cline + optional `sidecar_base_url` + `dry_run`)
  - `verify_mcp_setup` (auto/native/cline readiness report)
- Security contract:
  - setup path is whitelist-only (`Cursor/mcp.json` or `cline_mcp_settings.json`)
  - no arbitrary file write path is accepted from tool payload

## Screenshot Closure Notes
- Screenshot baseline is `capture_scene_screenshot(capture_mode=render_output)`.
- `diagnose-capture.js` now runs the combined capture diagnose chain:
  `get_ui_tree + get_ui_overlay_report + validate_ui_layout + capture_scene_screenshot`.
- Default report output file: `diagnose-capture-report.json`.
- `final_pixels` / `editor_view` are disabled and should return `E_CAPTURE_MODE_DISABLED`.
- `hit_test_ui_at_screen_point` is disabled and should return `E_COMMAND_DISABLED`.
- Removed script: `verify-final-pixels-mode.ps1` (no longer valid for R11-CLOSE).

## Capture Diagnose Script (R18-CAPTURE-B-01)
- Script: `diagnose-capture.js`
- Purpose: run screenshot + structured UI diagnostics in one command and emit a single JSON report for acceptance evidence.
- Example:
  - `node scripts/diagnose-capture.js --base-url http://127.0.0.1:46321 --scope-root Scene/Canvas/HUD`
  - `node scripts/diagnose-capture.js --view-mode game --width 1920 --height 1080 --output ./tmp/diagnose-capture-report.json`
- Key report checks:
  - capture baseline (`capture_mode_effective=render_output`, pixel sanity)
  - overlay coverage + recommendation (`get_ui_overlay_report`)
  - UI structure and runtime resolution (`get_ui_tree`)
  - layout issue summary (`validate_ui_layout`)

## UI V1 Diagnose Script
- Script: `diagnose-ui.js`
- Purpose: run V1 UI chain `get_ui_tree -> hit_test_ui_at_viewport_point -> validate_ui_layout -> (optional) set_ui_properties` and emit a single JSON report.
- Default output: `diagnose-ui-report.json` in current working directory.
- Example:
  - `node scripts/diagnose-ui.js --base-url http://127.0.0.1:46321 --scope-root Scene/Canvas/HUD --x 960 --y 540 --width 1920 --height 1080`
  - `node scripts/diagnose-ui.js --skip-set`
  - `node scripts/diagnose-ui.js --set-commit --output ./tmp/diagnose-ui-report.json`
- Key report checks:
  - runtime context fields (`runtime_resolution`, `runtime_source`)
  - hit-test mapping fields (`coord_origin`, `mapped_point`)
  - validate budget fields (`partial`, `truncated_reason`)
  - write planning fields (`planned_actions_count`, `mapped_actions`)

## UI Specialist Diagnose Script (R16-HYBRID-P3-01)
- Script: `diagnose-ui-specialist.js`
- Purpose: run `validate_ui_layout` in specialist mode (`include_repair_plan=true`) and verify that `repair_plan.recommended_action_type` is compatible with `get_action_catalog`.
- Default output: `diagnose-ui-specialist-report.json` in current working directory.
- Example:
  - `node scripts/diagnose-ui-specialist.js --base-url http://127.0.0.1:46321 --scope-root Scene/Canvas/HUD`
  - `node scripts/diagnose-ui-specialist.js --repair-style aggressive --max-repair-suggestions 10 --strict`
  - `node scripts/diagnose-ui-specialist.js --skip-catalog --output ./tmp/diagnose-ui-specialist-report.json`
- Key report checks:
  - specialist output fields (`specialist_summary`, `repair_plan`, `repair_plan_generated_by`)
  - action catalog compatibility (`all_recommended_actions_registered`)
  - repair strategy distribution summary (`top_repair_strategies`)

## Recommended Execution Order
1. `npm test`
2. `npm run test:r15:qa`
3. `npm run test:r16:qa`
4. `npm run test:r17:qa`
5. `npm run gate:r9-closure`
6. `npm run gate:r9-docs`
7. `npm run gate:r10-responsibility`
8. `npm run gate:r10-contract-snapshot`
9. `npm run gate:r10-docs`
10. `npm run gate:r11-command-boundary`
11. `npm run gate:r16-wire`
12. `npm run test:r10:qa`
13. `npm run smoke`
14. `npm run diagnose:ui -- --base-url http://127.0.0.1:46321 --skip-set`
15. `npm run diagnose:ui:specialist -- --base-url http://127.0.0.1:46321 --strict`

## R15 Split Guard Coverage
- `r10-responsibility-guard.js`
- Checks responsibility markers + forbidden cross-role imports.
- Enforces LOC ceilings for `validators.js`, `turnUtils.js`, `turnPayloadBuilders.js`, `turnPolicies.js`, `mcpErrorFeedback.js`.
- Enforces dependency direction for `src/domain/validators/**` and `src/utils/turn/**` (no reverse dependency into application/mcp layer).
- `r11-command-boundary-guard.js`
- Checks transport/application/domain boundary markers and forbidden fragments.
- Enforces LOC ceilings for command/registry/router/server/gateway orchestrator entry files.
- Enforces dependency direction for `src/mcp/commands/**` (no back-reference to router/mcpServer/turnService).

## Rule
- Do not add compatibility fallback scripts that bypass MCP write/read frozen contracts.
- Any new script must be documented here and referenced by `Assets/Docs/Codex-Unity-MCP-Main-Index.md`.

## R16 Hybrid Wire Guard
- Script: `r16-wire-guard.js`
- Purpose: verify R16 Phase-A wire contract closure and atomic test baseline visibility.
- Report includes:
  - wire markers (`action_data_json` external hardcut + `action_data_marshaled` internal bridge)
  - unexpected wire token exposures outside internal allowlist files
  - `AtomicActionTestBase` coverage map (`covered_action_types`, `missing_action_types`)
- Run:
  - `npm run gate:r16-wire`
  - `node scripts/r16-wire-guard.js --json`
  - `node scripts/r16-wire-guard.js --strict-atomic` (treat missing atomic coverage as hard fail)

## V1-POLISH Primitive Candidate Report (R17-POLISH-O11Y-02)
- Script: `generate-v1-polish-primitive-report.js`
- Purpose: aggregate `v1-polish-metrics.json` and output TopN high-frequency `property_path` candidates for primitive promotion review.
- Default input: `sidecar/.state/v1-polish-metrics.json`
- Default output: `sidecar/.state/v1-polish-primitive-candidates.json`
- Run:
  - `npm run metrics:v1-polish:report`
  - `npm run metrics:v1-polish:report:ci`
