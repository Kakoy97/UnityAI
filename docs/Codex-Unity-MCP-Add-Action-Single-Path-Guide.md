# Codex-Unity MCP Add-Action Single Path Guide (R10)

## 1. Goal
- Provide one stable onboarding path for adding a new visual action.
- Keep changes minimal and avoid cross-layer coupling by default.

## 2. Default Rule
- If you are adding a new Unity write capability under existing `apply_visual_actions`, do not touch L1/L2 schemas directly.
- Use the typed-handler registration path in L3, then rely on dynamic capability sync to expose it.

## 3. Single Path (Default)
1. Implement handler in L3:
- File: `Assets/Editor/Codex/Infrastructure/Actions/ValuePackVisualActionHandlers.cs`
- Pattern: `sealed class XxxHandler : McpVisualActionHandler<TDto>`
- Requirement: parse `action_data_json` into typed DTO and return clear error code on validation failure.

2. Register capability metadata:
- File: `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`
- Register with:
  - `action_type`
  - `description`
  - `anchor_policy`
  - `action_data_schema`
  - governance fields (`domain`, `tier`, `lifecycle`, `undo_safety`).

3. Implement executor primitive only if required:
- File: `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
- Add/extend one focused `RunXxx(...)` method if there is no reusable primitive.

4. Add tests:
- Unity EditMode:
  - `Assets/Editor/Codex/Tests/EditMode/ValuePackVisualActionHandlerTests.cs`
  - Add composite coverage in `CompositeVisualActionHandlerTests.cs` if action is intended for composite use.
- Sidecar:
  - Usually no validator changes are needed for standard new actions.
  - Add/update capability snapshot expectations only if response shape changes.

## 4. What Not To Change (Default Case)
- `sidecar/src/domain/validators.js` action-type enumeration (do not reintroduce hardcoded oneOf).
- `sidecar/src/mcp/mcpServer.js` static per-action schema blocks.
- Legacy switch-case branches for action execution.

## 5. When You Need More Than the Single Path
- Only touch L2 contract/validator logic when you are introducing a new protocol shape, not a normal new action.
- Typical examples:
  - new top-level tool
  - new callback envelope
  - new cross-step composite syntax

## 6. Quality Checklist
1. Action name follows `lower_snake_case`.
2. Capability metadata includes governance fields.
3. Error codes are specific and recoverable where appropriate.
4. Undo semantics are explicit for mutating operations.
5. `npm run test:r10:qa` and Unity EditMode tests pass.

## 7. Fast File Map
- Registry: `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`
- Handler: `Assets/Editor/Codex/Infrastructure/Actions/ValuePackVisualActionHandlers.cs`
- Executor primitive (optional): `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
- Unity tests: `Assets/Editor/Codex/Tests/EditMode/*`
- Sidecar capability visibility: `sidecar/src/application/capabilityStore.js`
