# UnityAI（Codex + Unity Sidecar）

简体中文 | [English](README.en.md)

UnityAI 是一个面向 Unity Editor 自动化的工程，核心由 MCP、Node.js sidecar 网关、SSOT 生成链路，以及 Unity 侧执行器组成。当前项目重点在于 planner-first 路由、契约安全、事务与恢复控制，以及面向高频 Unity 任务的 workflow-first 体验。

## 项目概览

- **L1：MCP 客户端入口**，负责 JSON-RPC 工具调用。
- **L2：Node.js sidecar**，负责 MCP 服务、路由、Schema 校验、编排与错误反馈。
- **L3：Unity Editor 运行层**，负责动作执行、查询轮询和编辑器侧集成。
- **SSOT 编译链路**，负责为 sidecar 和 Unity 生成共享契约与产物。

## 核心能力

- 基于 SSOT 的工具契约、Schema 和 DTO/产物生成。
- 基于 Planner / Block 的路由，以及 workflow-first 编排。
- OCC/read-token、锚点校验、事务、回滚、恢复等安全门禁。
- 面向 UI、布局、组件、编辑器自动化场景的查询与动作执行链路。
- sidecar 诊断脚本、smoke 脚本，以及以契约为中心的测试门禁。

## 目录结构

```text
Assets/                 Unity Editor 代码、执行器、测试与集成层
sidecar/                MCP 服务、路由、校验、编排、脚本与测试
ssot/                   工具字典、编译器、生成产物
docs/                   架构、方案、审计、路线图、验收文档
ProjectSettings/        Unity 版本和编辑器配置
```

## 快速开始

1. 使用 Unity `2021.3.45f2c1` 打开工程。
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

   `npm start` 会先执行 SSOT 构建，再启动 sidecar，默认地址是 `http://127.0.0.1:46321`。

4. 如果你使用 Cursor 的 MCP 集成，可以额外执行：

   ```bash
   cd sidecar
   npm run mcp:setup-cursor
   npm run mcp:verify
   ```

## 常用命令

```bash
cd sidecar
npm start          # 构建 SSOT 产物并启动 sidecar
npm test           # 运行当前 QA 测试集
npm run smoke      # 运行 smoke 场景
npm run ssot:build # 仅重建 SSOT 产物
```

## 文档入口

- [架构指南](docs/PROJECT_ARCHITECTURE_GUIDE.md)
- [架构与功能说明](docs/UnityAI架构与功能说明文档.md)
- [路线图](docs/ROADMAP.md)
- [Phase 20 协议可用性验收](docs/Phase20-Protocol-Usability-Acceptance.md)
- [当前未解决痛点](docs/MCP工具开发痛点记录V1.1-未解决问题.md)

## 当前状态

项目仍在持续迭代中。根 README 现在作为默认中文首页使用，更深入的设计、审计和实施方案都放在 `docs/` 目录下。
