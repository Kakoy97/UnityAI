# UnityAI (Codex + Unity Sidecar)

## Authority Entry
- Main index: `Assets/Docs/Codex-Unity-MCP-Main-Index.md`
- Final acceptance: `Assets/Docs/Phase8-Action-Governance-Acceptance.md`
- Extensibility blueprint: `docs/Codex-Unity-MCP-Extensibility-Decoupling-Execution-Blueprint.md`
- Governance blueprint: `docs/Codex-Unity-MCP-Action-Governance-Upgrade-Blueprint.md`
- Add-action single path: `docs/Codex-Unity-MCP-Add-Action-Single-Path-Guide.md`

## Quick Start
1. Open project in Unity (recommended `2021.3.45f2c1`).
2. Install sidecar dependencies:
```bash
cd sidecar
npm install
```
3. Run sidecar:
```bash
cd sidecar
npm start
```

## Required Gates (R10)
```bash
cd sidecar
npm run test:r10:qa
npm run gate:r10-responsibility
npm run gate:r10-contract-snapshot
npm run gate:r10-docs
npm run gate:r9-closure
npm run smoke
```

## Notes
- Historical planning docs were moved to `Assets/Docs/archive/` and are reference-only.
- Release decisions should follow `Assets/Docs/Phase8-Action-Governance-Acceptance.md`.
