# Phase 8 Action Governance Acceptance

## 1. Scope
- This document is the final acceptance baseline for R10 action-governance upgrade.
- It closes `R10-E2E-01` and confirms `R10-ARCH-06` documentation convergence.
- Hard guards must remain active: OCC, dual-anchor validation, atomic rollback, and structured error feedback.

## 2. Preconditions
1. Sidecar dependencies are installed:
```bash
cd sidecar
npm install
```
2. Unity Editor is opened at least once and has reported runtime ping + capabilities.
3. Core R10 regression gates are green:
```bash
cd sidecar
npm run test:r10:qa
npm run gate:r10-responsibility
npm run gate:r10-contract-snapshot
npm run gate:r10-docs
```

## 3. End-to-End Cases

### 3.1 Case A: Composite Success With Alias Context Piping
1. Submit `apply_visual_actions` with one `composite_visual_action`.
2. In `steps`, Step 1 creates a child object and binds `created_object -> alias`.
3. Step 2 references `target_anchor_ref` or `parent_anchor_ref` using that alias.
4. Expected:
- Request passes L2 validation.
- L3 executes successfully.
- Result returns success, and created hierarchy is visible in scene.

### 3.2 Case B: Composite Failure Rolls Back Atomically
1. Submit a composite where Step 2 is guaranteed to fail (for example invalid component type).
2. Expected:
- L3 returns `E_COMPOSITE_STEP_FAILED`.
- Objects created in previous steps do not remain in scene.
- No partial dirty state remains after rollback verification.

### 3.3 Case C: Error-Driven Schema Compensation Works
1. Submit invalid composite payload (`E_COMPOSITE_PAYLOAD_INVALID`), such as missing required step fields.
2. Expected:
- Sidecar response includes `schema_hint` or `schema_ref`.
- `recoverable=true` and retry guidance is present.
- LLM can retry directly without an extra exploratory tool call.

### 3.4 Case D: Capability Version Mismatch Recovery
1. Call `get_action_catalog` or `get_action_schema` with a stale `catalog_version`.
2. Expected:
- Returns `409 E_ACTION_CAPABILITY_MISMATCH`.
- Error payload includes recovery suggestion to refresh capability view.

### 3.5 Case E: Token-Budget Aware Capability Flow
1. Request `tools/list` when action count is large.
2. Expected:
- Tool description remains compact (`action_hints` and lookup tools only).
- Full schema is fetched through `get_action_catalog/get_action_schema`.
- No full-schema dumping in default tool list.

## 4. Mandatory Gates

### 4.1 Sidecar
```bash
cd sidecar
npm run test:r10:qa
npm run gate:r10-responsibility
npm run gate:r10-contract-snapshot
npm run gate:r10-docs
npm run smoke
```

### 4.2 Unity EditMode
- `CompositeVisualActionHandlerTests`
- `CompositeAliasTableTests`
- `CompositeTransactionRunnerTests`
- `McpActionRegistryTests`
- `ValuePackVisualActionHandlerTests`

## 5. Documentation Convergence (R10-ARCH-06)
- `Assets/Docs/Codex-Unity-MCP-Main-Index.md` is the single authority entry.
- `docs/Codex-Unity-MCP-Action-Governance-Upgrade-Blueprint.md` is the architecture blueprint.
- `docs/Codex-Unity-MCP-Add-Action-Single-Path-Guide.md` is the only onboarding path for adding actions.
- `README.zh-CN.md` and `sidecar/README.md` both point to the same authority chain.

## 6. Exit Criteria
1. R10 sidecar gates are all green.
2. Unity EditMode composite/action-governance tests are green.
3. E2E cases A-E are reproducible.
4. Documentation points to one onboarding path with no conflicting guidance.

## 7. Sign-off Checklist
- [ ] Sidecar R10 gates green.
- [ ] Unity EditMode suite green.
- [ ] Composite success + rollback E2E validated.
- [ ] Schema compensation flow validated.
- [ ] Capability mismatch recovery validated.
- [ ] Main index + README links aligned.
