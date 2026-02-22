# UnityAI (Codex + Unity Sidecar)

This repository contains a Unity Editor integration with a local Node.js sidecar for Codex-driven code and scene workflows.

## Current Status

- Refactor roadmap is defined and actively executed.
- Step 0 (baseline and regression gate) is completed.
- Step 1 (execution-kernel timeout/cancel stabilization) is completed.
- Next target is Step 2 (planner/prompt streamlining).

Main planning docs:

- `Assets/Docs/Codex-Unity-Refactor-Roadmap.md`
- `Assets/Docs/Codex-Unity-Refactor-Execution-Plan.md`
- `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- `Assets/Docs/Codex-Unity-Panel-Status-Report.md`

## Repository Layout

- `Assets/` Unity editor extension and docs
- `Packages/` Unity package manifest
- `ProjectSettings/` Unity project settings
- `sidecar/` Node.js sidecar service and smoke tools

## Requirements

- Unity `2021.3.45f2c1`
- Node.js `18+` (recommended)

## Quick Start

1. Open this project in Unity Hub using Unity `2021.3.45f2c1`.
2. Install sidecar dependencies:

```bash
cd sidecar
npm install
```

3. Start sidecar:

```bash
npm start
```

4. Use the Unity panel to start a session and send turns.

## Sidecar Smoke Checks

From `sidecar/`:

```bash
npm run smoke
npm run smoke:fast
npm run smoke:codex-timeout
```

Smoke reports are generated under `sidecar/.state/` (ignored by git).

## Notes

- File writes are restricted to `Assets/Scripts/AIGenerated/`.
- Unity serialized assets (`.unity`, `.prefab`, `.asset`) are blocked from text writes by design.
- Runtime/temporary generated folders are excluded by `.gitignore`.
