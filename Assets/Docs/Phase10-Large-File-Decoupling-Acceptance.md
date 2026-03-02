# Phase 10 Large File Decoupling Acceptance (R15-SPLIT)

## 1. Scope
- This document is the single acceptance entry for:
  - `R15-SPLIT-ASSET-01`
  - `R15-SPLIT-QA-01`
  - `R15-SPLIT-QA-02`
  - `R15-SPLIT-E2E-01`
- Target: freeze the large-file decoupling baseline after L2/L3 split and ensure entry facades stay thin.

## 2. Success Criteria
1. Sidecar guard assets enforce both responsibility direction and LOC ceiling.
2. Sidecar regression proves facade compatibility and behavior consistency after split.
3. Unity EditMode regression covers read chain, write chain, and contract split closure.
4. New command/action/query onboarding path is fixed and reproducible from this document.

## 3. Preconditions
1. Sidecar dependencies installed:
```bash
cd sidecar
npm install
```
2. Unity project opens and compiles in Editor.
3. Sidecar endpoint available at `http://127.0.0.1:46321`.

## 4. Automated Gates

### 4.1 R15-SPLIT-ASSET-01 Guard Assets
```bash
cd sidecar
npm run gate:r10-responsibility
npm run gate:r11-command-boundary
```

Expected:
- both guards pass
- checks include:
  - responsibility markers and forbidden cross-layer imports
  - LOC limits for split facades/entry files
  - dependency direction checks for split directories (`domain/validators`, `utils/turn`, `mcp/commands`)

### 4.2 R15-SPLIT-QA-01 Sidecar Regression
Focused R15 gate:
```bash
cd sidecar
npm run test:r15:qa
```

Full sidecar regression:
```bash
cd sidecar
npm test
```

Expected:
- all tests pass
- includes facade compatibility parity:
  - `tests/domain/r15-split-facade-compatibility.test.js`
- includes script-gate regression:
  - `tests/application/r10-arch-guard-scripts.test.js`
  - `tests/application/r11-arch-guard-scripts.test.js`

### 4.3 R15-SPLIT-QA-02 Unity EditMode Regression
Run in Unity Test Runner (`EditMode`):
- `UnityR15SplitClosureGuardTests`
- `UnityVisualReadChainTests`
- `UnityRagReadServiceUiTreeTests`
- `UnityRagReadServiceHitTestViewportTests`
- `UnityUiLayoutValidatorTests`
- `UnityVisualActionRegistryExecutorTests`
- `ValuePackVisualActionHandlerTests`
- `SidecarContractsSnapshotTests`
- `SidecarContractsExtensibilityDtoTests`

Expected:
- compile succeeds
- listed suites pass

## 5. E2E Shortest Paths (R15-SPLIT-E2E-01)

### 5.1 Add One New MCP Command (Sidecar)
1. Add command module files under `sidecar/src/mcp/commands/<command_name>/`:
- `validator.js`
- `handler.js` (if command executes runtime behavior)
2. Register command in `sidecar/src/mcp/commands/legacyCommandManifest.js`.
3. Run:
```bash
cd sidecar
npm run gate:r11-command-boundary
node --test "tests/application/*command*.test.js" "tests/application/*schema*.test.js"
```
4. Expected:
- command appears in registry/tools contract path
- no manual route/switch branch reintroduced in transport entry files

### 5.2 Add One New Unity Visual Action
1. Add action handler in `Assets/Editor/Codex/Infrastructure/Actions/`.
2. Register in `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`.
3. Do not add primitive logic into `UnityVisualActionExecutor.cs` (executor remains dispatch/normalize only).
4. Run Unity EditMode:
- `UnityVisualActionRegistryExecutorTests`
- `ValuePackVisualActionHandlerTests` (or dedicated action test)
5. Expected:
- action resolved by registry
- unknown action remains fail-closed (`E_ACTION_HANDLER_NOT_FOUND`)

### 5.3 Add One New Unity Read Query
1. Add query handler in `Assets/Editor/Codex/Infrastructure/Queries/Handlers/`.
2. Register in `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs`.
3. Do not add per-query branch to `ConversationController`.
4. Run Unity EditMode:
- `UnityQueryRegistryTests`
- `UnityQueryRegistryDispatchTests`
- `UnityQueryControllerClosureTests`
5. Expected:
- controller dispatch path remains registry-only
- unsupported query keeps `E_UNSUPPORTED_QUERY_TYPE`

## 6. Evidence Checklist
Store artifacts under:
- `Assets/Docs/evidence/phase10-r15/<yyyy-mm-dd>/`

Required:
1. Sidecar guard outputs (`gate:r10-responsibility`, `gate:r11-command-boundary`).
2. Sidecar QA outputs (`test:r15:qa`, `npm test`).
3. Unity EditMode pass screenshot(s) for listed suites.
4. One shortest-path onboarding evidence set (command or action or query).

## 7. Sign-off
- [ ] `R15-SPLIT-ASSET-01` complete
- [ ] `R15-SPLIT-QA-01` complete
- [ ] `R15-SPLIT-QA-02` complete
- [ ] `R15-SPLIT-E2E-01` complete
