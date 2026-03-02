# Codex-Unity MCP Main Index (R15-SPLIT Baseline)

## 1. Purpose
- This file is the single authoritative entry for R15 large-file decoupling baseline (keeps R10/R11/R12/Phase D history).
- New contributors should start here and follow the standard execution path.

## 2. Authoritative Docs
1. Extensibility baseline blueprint:
`docs/Codex-Unity-MCP-Extensibility-Decoupling-Execution-Blueprint.md`
2. Action-governance blueprint:
`docs/Codex-Unity-MCP-Action-Governance-Upgrade-Blueprint.md`
3. MCP command decoupling blueprint:
`docs/Codex-Unity-MCP-Command-Development-Optimization-Blueprint.md`
4. Add-action single path guide:
`docs/Codex-Unity-MCP-Add-Action-Single-Path-Guide.md`
5. R10 final acceptance:
`Assets/Docs/Phase8-Action-Governance-Acceptance.md`
6. R11 final acceptance:
`Assets/Docs/Phase9-MCP-Command-Decoupling-Acceptance.md`
7. R12 final acceptance:
`Assets/Docs/Phase10-L3-Query-Registry-Acceptance.md`
8. Phase D architecture closure acceptance:
`Assets/Docs/Phase11-Architecture-Decoupling-Acceptance.md`
9. R15 large-file decoupling acceptance:
`Assets/Docs/Phase10-Large-File-Decoupling-Acceptance.md`
10. Screenshot stabilization + registry closure blueprint:
`docs/Codex-Unity-MCP-Screenshot-Stabilization-Closure-Blueprint.md`
11. Previous phase references:
- `Assets/Docs/Phase2-OCC-Acceptance.md`
- `Assets/Docs/Phase3-Anchor-Acceptance.md`
- `Assets/Docs/Phase4-Zombie-Cleanup-Acceptance.md`
- `Assets/Docs/Phase5-Error-Feedback-Acceptance.md`
- `Assets/Docs/Phase6-Strangler-Closure-Acceptance.md`
- `Assets/Docs/Phase7-Extensibility-Decoupling-Acceptance.md`

## 3. Execution Order (New Contributor Path)
1. Install and run sidecar:
```bash
cd sidecar
npm install
npm start
```
2. Run R15/R10/R11/R12 regression and document guards:
```bash
cd sidecar
npm run test:r15:qa
npm run test:r10:qa
npm run gate:r10-responsibility
npm run gate:r10-contract-snapshot
npm run gate:r10-docs
npm run gate:r11-command-boundary
node --test "tests/application/r11-*.test.js" "tests/application/r11-screenshot-route-and-feedback.test.js"
node --test "tests/application/r12-*.test.js" "tests/application/*command*.test.js" "tests/application/*schema*.test.js"
```
3. Run Phase D closure gate:
```bash
cd sidecar
npm run test:phase-d:qa
```
4. Run smoke scripts:
```bash
cd sidecar
npm run smoke
```
5. Run Unity EditMode tests for composite/governance + command/query baseline:
- `CompositeVisualActionHandlerTests`
- `CompositeAliasTableTests`
- `CompositeTransactionRunnerTests`
- `McpActionRegistryTests`
- `UnityR15SplitClosureGuardTests`
- `ValuePackVisualActionHandlerTests`
- `UnityRagReadServiceScreenshotTests`
- `UnityQueryRegistryTests`
- `UnityQueryRegistryDispatchTests`
- `UnityQueryControllerClosureTests`
- `SidecarContractsExtensibilityDtoTests`
- `SidecarContractsSnapshotTests`
- `UnityErrorFeedbackReceiptTests`
- `UnityAnchorExecutionTests`

## 4. Script Whitelist
Active validation scripts:
- `sidecar/scripts/mcp-job-runner.js`
- `sidecar/scripts/mcp-stream-runner.js`
- `sidecar/scripts/mcp-visual-anchor-regression.js`
- `sidecar/scripts/r10-responsibility-guard.js`
- `sidecar/scripts/r10-contract-snapshot-guard.js`
- `sidecar/scripts/r10-doc-index-guard.js`
- `sidecar/scripts/r11-command-boundary-guard.js`
- `sidecar/scripts/r9-closure-guard.js`
- `sidecar/scripts/replay-failed-report.js`
- `sidecar/scripts/setup-cursor-mcp.js`
- `sidecar/scripts/verify-mcp-setup.js`

## 5. Archive Policy
- Superseded planning/index docs are moved to `Assets/Docs/archive/`.
- `Assets/Docs/archive/` is reference-only and must not be treated as release authority.
- Any new release gate must be reflected in this file and in `README*.md`.
