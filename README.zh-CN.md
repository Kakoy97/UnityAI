# UnityAI（Codex + Unity Sidecar）

## 权威入口
- 主索引：`Assets/Docs/Codex-Unity-MCP-Main-Index.md`
- 最终验收：`Assets/Docs/Phase8-Action-Governance-Acceptance.md`
- 扩展解耦蓝图：`docs/Codex-Unity-MCP-Extensibility-Decoupling-Execution-Blueprint.md`
- 动作治理蓝图：`docs/Codex-Unity-MCP-Action-Governance-Upgrade-Blueprint.md`
- 新增动作唯一主路径：`docs/Codex-Unity-MCP-Add-Action-Single-Path-Guide.md`

## 快速开始
1. 使用 Unity 打开工程（建议 `2021.3.45f2c1`）。
2. 安装 sidecar 依赖：
```bash
cd sidecar
npm install
```
3. 启动 sidecar：
```bash
cd sidecar
npm start
```

## 必跑门禁（R10）
```bash
cd sidecar
npm run test:r10:qa
npm run gate:r10-responsibility
npm run gate:r10-contract-snapshot
npm run gate:r10-docs
npm run gate:r9-closure
npm run smoke
```

## 说明
- 历史规划文档已迁移到 `Assets/Docs/archive/`，仅供参考。
- 发布是否通过，以 `Assets/Docs/Phase8-Action-Governance-Acceptance.md` 为准。
