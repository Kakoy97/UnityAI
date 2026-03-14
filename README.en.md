# UnityAI (Codex + Unity Sidecar)

[English](README.en.md) | [简体中文](README.zh-CN.md)

UnityAI is a Unity Editor automation stack built around MCP, a Node.js sidecar gateway, SSOT-generated contracts, and Unity-side executors. The project focuses on planner-first routing, contract safety, transaction and recovery control, and workflow-first UX for high-frequency Unity tasks.

## Overview

- **L1: MCP client entry** for JSON-RPC tool calls.
- **L2: Node.js sidecar** for MCP serving, routing, schema validation, orchestration, and error feedback.
- **L3: Unity Editor runtime** for action execution, query polling, and editor-side integration.
- **SSOT compiler pipeline** that generates shared contracts and artifacts for sidecar and Unity.

## Key capabilities

- SSOT-driven tool contracts, schemas, and generated DTO/artifact outputs.
- Planner and block-based routing with workflow-first orchestration.
- OCC/read-token, anchor validation, transaction, rollback, and recovery gates.
- Unity query and action flows for UI/layout/component/editor automation scenarios.
- Sidecar diagnostics, smoke scripts, and contract-focused test gates.

## Repository layout

```text
Assets/                 Unity Editor code, executors, tests, and integration layers
sidecar/                MCP server, routing, validation, orchestration, scripts, tests
ssot/                   Tool dictionary, compiler, generated artifacts
docs/                   Architecture, plans, audits, roadmap, acceptance docs
ProjectSettings/        Unity project version and editor configuration
```

## Quick start

1. Open the project with Unity `2021.3.45f2c1`.
2. Install sidecar dependencies:

   ```bash
   cd sidecar
   npm install
   ```

3. Start the sidecar:

   ```bash
   cd sidecar
   npm start
   ```

   `npm start` runs the SSOT build first, then launches the sidecar on `http://127.0.0.1:46321`.

4. If you use Cursor MCP integration, optionally run:

   ```bash
   cd sidecar
   npm run mcp:setup-cursor
   npm run mcp:verify
   ```

## Common commands

```bash
cd sidecar
npm start          # build SSOT artifacts and run the sidecar
npm test           # run the current QA test bundle
npm run smoke      # run smoke scenarios
npm run ssot:build # rebuild SSOT artifacts only
```

## Documentation

- [Architecture guide](docs/PROJECT_ARCHITECTURE_GUIDE.md)
- [Architecture and feature document](docs/UnityAI架构与功能说明文档.md)
- [Roadmap](docs/ROADMAP.md)
- [Phase 20 protocol usability acceptance](docs/Phase20-Protocol-Usability-Acceptance.md)
- [Open pain points and gaps](docs/MCP工具开发痛点记录V1.1-未解决问题.md)

## Status

This repository is under active iteration. The root README is now the landing page; deeper design details, audits, and rollout plans live under `docs/`.
