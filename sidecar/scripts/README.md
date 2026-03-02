# Sidecar Script Index (R15-SPLIT Baseline)

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

## Utility Scripts
- `diagnose-capture.js`
- `diagnose-ui.js`
- `replay-failed-report.js`
- `setup-cursor-mcp.js`
- `verify-mcp-setup.js`

## Screenshot Closure Notes
- Screenshot baseline is `capture_scene_screenshot(capture_mode=render_output)` + `get_ui_tree`.
- `diagnose-capture.js` only validates this baseline flow.
- `final_pixels` / `editor_view` are disabled and should return `E_CAPTURE_MODE_DISABLED`.
- `hit_test_ui_at_screen_point` is disabled and should return `E_COMMAND_DISABLED`.
- Removed script: `verify-final-pixels-mode.ps1` (no longer valid for R11-CLOSE).

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

## Recommended Execution Order
1. `npm test`
2. `npm run test:r15:qa`
3. `npm run gate:r9-closure`
4. `npm run gate:r9-docs`
5. `npm run gate:r10-responsibility`
6. `npm run gate:r10-contract-snapshot`
7. `npm run gate:r10-docs`
8. `npm run gate:r11-command-boundary`
9. `npm run test:r10:qa`
10. `npm run smoke`
11. `npm run diagnose:ui -- --base-url http://127.0.0.1:46321 --skip-set`

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
