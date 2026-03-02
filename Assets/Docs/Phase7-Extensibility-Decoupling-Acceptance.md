# Phase 7 Extensibility-Decoupling Acceptance

## 1. Scope
- Freeze release acceptance for R9:
- `R9-ASSET-01` documentation/script asset closure.
- `R9-E2E-01` end-to-end flow from unknown action submission to dynamic schema retrieval.
- Hard guards must remain enforced: OCC, dual anchors, auto-cancel cleanup, error-feedback templates.

## 2. Preconditions
1. Sidecar dependencies installed:
```bash
cd sidecar
npm install
```
2. Sidecar regression baseline green:
```bash
cd sidecar
npm test
```
3. Unity Editor connected at least once to publish runtime ping and capabilities.

## 3. E2E Cases

### 3.1 Case A: Unknown Action Submission Is Routed and Diagnosable
1. Submit `apply_visual_actions` with:
- valid `based_on_read_token`
- valid top-level `write_anchor`
- action `type = "set_ui_image_color"` (not built-in handler)
- valid `target_anchor`
- `action_data` object
2. Expected:
- Request is accepted by L2 schema/anchor validation.
- L3 returns `E_ACTION_HANDLER_NOT_FOUND`.
- Sidecar error feedback includes non-empty `suggestion` and `recoverable=true`.

### 3.2 Case B: Dynamic Schema Pull Works
1. Call `get_action_schema` with an action type present in capability report.
2. Expected:
- returns `action.type`, `anchor_policy`, `action_data_schema`.
3. Call with an unknown action type.
4. Expected:
- returns failure with clear guidance to refresh `tools/list`.

### 3.3 Case C: Unity Reload Re-Publishes Capability
1. Trigger Unity domain reload (script recompile or editor reload).
2. Expected:
- `unity.runtime.ping` continues heartbeat recovery behavior.
- `unity.capabilities.report` is auto-sent after reload.
- sidecar `unity_connection_state` reaches `ready` after capability report.

### 3.4 Case D: Offline Fast-Fail Is Stable
1. Keep sidecar running, disconnect or stop Unity signal path.
2. Submit write tool.
3. Expected:
- fast-fail with `E_UNITY_NOT_CONNECTED`.
- request does not enter active queue.

## 4. Gate Commands
Run the mandatory release gates:
```bash
cd sidecar
npm test
npm run gate:r9-closure
npm run gate:r9-docs
npm run smoke
```

Unity mandatory gates:
- Unity compilation passes.
- EditMode tests pass, including:
  - `UnityR9ClosureGuardTests`
  - `UnityRuntimeRecoveryTests`
  - `UnityVisualActionRegistryExecutorTests`
  - `McpVisualActionContextTests`

## 5. Acceptance Criteria
1. Unknown action path is no longer blocked by L2 enum validation.
2. L3 errors are granular and preserved end-to-end (no collapse to generic code).
3. Dynamic capability + schema pull flow is usable by MCP clients.
4. R9 closure guards prevent legacy branch regression.
5. Main documentation entry is unique and consistent with README links.

## 6. Sign-off Checklist
- [ ] Sidecar test suite green.
- [ ] `gate:r9-closure` green.
- [ ] `gate:r9-docs` green.
- [ ] Smoke scripts green.
- [ ] Unity EditMode suite green.
- [ ] No release-blocking regression in OCC/anchor/error-template guards.
