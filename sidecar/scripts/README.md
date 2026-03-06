# Sidecar Script Index (SSOT Baseline)

## Active QA / Utility Scripts
- `mcp-job-runner.js`
- `mcp-stream-runner.js`
- `mcp-visual-anchor-regression.js`
- `step8-quality-gate.js`
- `diagnose-capture.js`
- `diagnose-ui.js`
- `diagnose-ui-specialist.js`
- `generate-r20-ux-governance-baseline.js`
- `generate-v1-polish-primitive-report.js`
- `replay-failed-report.js`
- `setup-cursor-mcp.js`
- `verify-mcp-setup.js`
- `prestart-cleanup.js`

## Recommended Execution Order
1. `npm test`
2. `npm run smoke`
3. `npm run diagnose:ui -- --base-url http://127.0.0.1:46321 --skip-set`
4. `npm run diagnose:ui:specialist -- --base-url http://127.0.0.1:46321 --strict`

## Rule
- Do not add compatibility fallback scripts for removed legacy contracts.
- Any new script must align with SSOT-only command contracts.
