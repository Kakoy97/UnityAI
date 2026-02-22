# UnityAI（Codex + Unity Sidecar）

本仓库是一个 Unity Editor 集成项目，配合本地 Node.js sidecar，实现 Codex 驱动的代码与场景工作流。

## 当前状态

- 重构路线图已明确，正在按阶段执行。
- Step 0（基线与回归门禁）已完成。
- Step 1（执行内核超时/取消稳定化）已完成。
- 下一步目标是 Step 2（Planner/Prompt 轻量化）。

核心规划文档：

- `Assets/Docs/Codex-Unity-Refactor-Roadmap.md`
- `Assets/Docs/Codex-Unity-Refactor-Execution-Plan.md`
- `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- `Assets/Docs/Codex-Unity-Panel-Status-Report.md`

## 仓库结构

- `Assets/` Unity 编辑器扩展与文档
- `Packages/` Unity 包配置
- `ProjectSettings/` Unity 项目设置
- `sidecar/` Node.js sidecar 服务与 smoke 工具

## 环境要求

- Unity `2021.3.45f2c1`
- Node.js `18+`（推荐）

## 快速开始

1. 用 Unity Hub（`2021.3.45f2c1`）打开本项目。
2. 安装 sidecar 依赖：

```bash
cd sidecar
npm install
```

3. 启动 sidecar：

```bash
npm start
```

4. 在 Unity 面板中启动会话并发送任务回合。

## Sidecar Smoke 校验

在 `sidecar/` 目录执行：

```bash
npm run smoke
npm run smoke:fast
npm run smoke:codex-timeout
```

Smoke 报告会输出到 `sidecar/.state/`（已在 git 中忽略）。

## 说明

- 文件写入范围限制为 `Assets/Scripts/AIGenerated/`。
- Unity 序列化资产（`.unity`、`.prefab`、`.asset`）默认禁止文本写入。
- 运行时/临时产物目录已通过 `.gitignore` 排除。
