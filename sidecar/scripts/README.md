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
- `generate-g1-baseline-report.js`
- `generate-g1-tool-priority-freeze.js`
- `generate-v1-polish-primitive-report.js`
- `generate-planner-stepcd-gate-report.js`
- `generate-planner-alias-retirement-gate-report.js`
- `generate-planner-cutover-gate-report.js`
- `replay-failed-report.js`
- `setup-cursor-mcp.js`
- `verify-mcp-setup.js`
- `prestart-cleanup.js`

## Recommended Execution Order
1. `npm test`
2. `npm run smoke`
3. `npm run diagnose:ui -- --base-url http://127.0.0.1:46321 --skip-set`
4. `npm run diagnose:ui:specialist -- --base-url http://127.0.0.1:46321 --strict`

## G1 Baseline (PR-1)
- Command: `npm run metrics:g1:baseline -- --input ./scripts/g1-baseline-samples.json`
- Output default: `sidecar/.state/g1-baseline-report.json`
- Key observability outputs:
  - `metrics.get_write_contract_bundle_p95_latency_ms`
  - `metrics.structured_error_response_p95_bytes`
  - `recovery_observability.*` (attempt/success/failure/rate/latency/alerts)
- Alert threshold options:
  - `--recovery-success-threshold <0..1>`
  - `--recovery-latency-threshold-ms <ms>`
- Baseline fixture: `sidecar/scripts/g1-baseline-samples.json` (closure dataset, 5 scenario types * 20 samples)
- Input template: `sidecar/scripts/g1-baseline-samples.example.json`
- Coverage-corrected fixture: `sidecar/scripts/g1-baseline-samples.corrected.json` (adds high-frequency direct-write scenarios)
- Coverage-corrected run: `npm run metrics:g1:baseline -- --input ./scripts/g1-baseline-samples.corrected.json --output ./.state/g1-baseline-report.corrected.json`

## G1 Priority Freeze (PR-2 / G1-0.5)
- Generate freeze report: `npm run metrics:g1:priority -- --baseline ./.state/g1-baseline-report.json`
- Apply freeze into dictionary: `npm run metrics:g1:priority -- --baseline ./.state/g1-baseline-report.json --write-dictionary`
- Output default: `sidecar/.state/g1-tool-priority-freeze.json`
- Coverage-corrected freeze writeback: `npm run metrics:g1:priority -- --baseline ./.state/g1-baseline-report.corrected.json --output ./.state/g1-tool-priority-freeze.corrected.json --write-dictionary`

## Planner Step C / Step D Gate Report
- Generate report: `npm run metrics:planner:stepcd:gate -- --input ./scripts/planner-stepcd-gate-samples.json`
- CI gate mode: `npm run metrics:planner:stepcd:gate:ci`
- Output default: `sidecar/.state/planner-stepcd-gate-report.json`
- Snapshot input source:
  - `mcp_runtime.planner_visibility_profile`
  - `mcp_runtime.planner_direct_compatibility`

## Planner Alias Retirement Gate Report (PLNR-009)
- Generate report: `npm run metrics:planner:alias-retire:gate -- --input ./scripts/planner-alias-retirement-gate-samples.json`
- CI gate mode: `npm run metrics:planner:alias-retire:gate:ci`
- Output default: `sidecar/.state/planner-alias-retirement-gate-report.json`
- Retirement thresholds:
  - `alias share < 1%` over `14` consecutive days
  - `P1+ incidents = 0` in the same window
  - `release windows >= 2` after deprecation announcement

## Planner Step6 Cutover Gate Report (PLNR-STEP6)
- Generate report: `npm run metrics:planner:cutover:gate -- --input ./scripts/planner-cutover-gate-samples.json`
- CI gate mode: `npm run metrics:planner:cutover:gate:ci`
- Output default: `sidecar/.state/planner-cutover-gate-report.json`
- Composite checks:
  - Step C/D gate report `all_passed=true`
  - alias retirement gate report `all_passed=true`
  - entry governance `enabled=true` and `active_mode=reject`
  - planner visibility `active_profile=planner_first`
  - direct compatibility `active_mode=deny`
  - runtime first-hop planner share `=100%`
  - `external_direct_runtime_call_total=0`
  - `planner_entry_alias_call_total=0`

## Rule
- Do not add compatibility fallback scripts for removed legacy contracts.
- Any new script must align with SSOT-only command contracts.
