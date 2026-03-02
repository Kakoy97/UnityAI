# UnityAI 仓库架构情报报告

**生成时间**: 2024-12-19  
**审计范围**: 全仓库（Unity C# + Node.js Sidecar）  
**审计原则**: 只读分析，不修改任何文件

---

## 0) 仓库概览

### 0.1 主要语言/技术栈

| 技术栈 | 用途 | 主要目录 |
|--------|------|----------|
| **C# (Unity)** | Unity Editor 插件，MCP Action/Query 执行端 | `Assets/Editor/Codex/` |
| **Node.js (JavaScript)** | MCP Sidecar 网关，HTTP API 服务 | `sidecar/src/` |
| **Unity Package Manager** | Unity 依赖管理 | `Packages/manifest.json` |
| **npm** | Sidecar 依赖管理 | `sidecar/package.json` |

### 0.2 顶层目录树（深度 2-3）

```
UnityAI/
├── Assets/                          # Unity 资源与脚本
│   ├── Docs/                       # Unity 侧文档（29个 .md 文件）
│   ├── Editor/                     # Unity Editor 插件代码
│   │   └── Codex/                  # 核心业务代码
│   │       ├── Application/        # 应用层：ConversationController（主控制器）
│   │       ├── Domain/              # 领域层：SidecarContracts（DTO/契约）
│   │       ├── Infrastructure/     # 基础设施层：Action/Query 执行器、注册表
│   │       ├── Ports/              # 端口：接口定义（ISidecarGateway 等）
│   │       ├── Tests/               # 测试：EditMode 单元测试
│   │       └── UI/                  # UI：CodexChatWindow
│   ├── Scenes/                      # Unity 场景文件
│   └── Scripts/                     # 用户脚本目录（空）
├── docs/                            # 架构文档与蓝图
│   ├── ARCHITECTURE_AUDIT.md        # ⭐ 架构审计报告（关键）
│   ├── Codex-Unity-MCP-*.md        # 各阶段蓝图文档
│   └── VISION_V1_PLAN.md           # 愿景规划
├── sidecar/                         # Node.js MCP Sidecar 服务
│   ├── src/                         # 源码
│   │   ├── mcp/                     # MCP 协议层
│   │   │   ├── mcpServer.js         # MCP JSON-RPC 入口
│   │   │   ├── commandRegistry.js   # 命令注册表
│   │   │   └── commands/            # 命令模块（每个命令独立目录）
│   │   ├── api/                     # HTTP API 层
│   │   │   └── router.js            # HTTP 路由分发
│   │   ├── application/             # 应用服务层
│   │   │   ├── turnService.js       # 对话轮次服务
│   │   │   ├── mcpGateway/          # MCP 网关（读写服务）
│   │   │   ├── unityDispatcher/     # Unity 请求构建与分发
│   │   │   ├── queryRuntime/        # Query 协调与存储
│   │   │   └── jobRuntime/          # Job 队列与租约管理
│   │   ├── domain/                  # 领域层
│   │   │   └── validators.js         # ⚠️ 巨型验证器（4300+ 行）
│   │   ├── ports/                   # 端口层
│   │   │   └── contracts.js         # 协议冻结契约
│   │   └── infrastructure/          # 基础设施
│   ├── scripts/                     # 工具脚本（门禁、质量检查）
│   ├── tests/                       # 测试套件
│   └── package.json                 # npm 配置
├── ProjectSettings/                 # Unity 项目设置
├── Packages/                        # Unity Package Manager 依赖
├── Library/                         # Unity 生成缓存（gitignore）
├── Temp/                            # Unity 临时文件（gitignore）
└── Logs/                            # Unity 日志（gitignore）
```

### 0.3 关键文件存在性检查

| 文件类型 | 路径 | 状态 | 说明 |
|---------|------|------|------|
| **README** | `README.md`, `README.zh-CN.md`, `README.en.md` | ✅ 存在 | 多语言 README |
| **CONTRIBUTING** | - | ❌ 缺失 | 无贡献指南 |
| **ARCHITECTURE/ADR** | `docs/ARCHITECTURE_AUDIT.md` | ✅ 存在 | ⭐ 详细架构审计报告 |
| **docs/** | `docs/`, `Assets/Docs/` | ✅ 存在 | 架构蓝图与验收文档 |
| **.github/workflows** | - | ❌ 缺失 | 无 CI 配置 |
| **Makefile** | - | ❌ 缺失 | 无 Makefile |
| **package.json** | `sidecar/package.json` | ✅ 存在 | npm 脚本与依赖 |
| ***.sln/*.csproj** | - | ❌ 缺失 | Unity 项目，无 .sln（gitignore） |
| **pyproject.toml** | - | ❌ 缺失 | 非 Python 项目 |
| **.gitignore** | `.gitignore` | ✅ 存在 | 排除 Unity 生成文件、node_modules |

---

## 1) 构建/运行/测试方式

### 1.1 Unity 子工程

| 操作 | 命令/方式 | 说明 |
|------|-----------|------|
| **安装依赖** | Unity Package Manager 自动解析 `Packages/manifest.json` | Unity 编辑器打开项目时自动安装 |
| **构建** | Unity Editor 打开项目 | 无需单独构建命令 |
| **测试** | Unity Test Runner（EditMode） | 测试文件位于 `Assets/Editor/Codex/Tests/EditMode/` |
| **Lint/Format** | 无明确配置 | 可能依赖 IDE（Rider/VS Code）的 C# 格式化 |

### 1.2 Sidecar 子工程（Node.js）

| 操作 | 命令 | 说明 |
|------|------|------|
| **安装依赖** | `cd sidecar && npm install` | 安装 npm 依赖 |
| **启动服务** | `cd sidecar && npm start` | 启动 MCP Sidecar（端口 46321） |
| **单元测试** | `cd sidecar && npm test` | 运行所有测试 |
| **R10 质量门禁** | `cd sidecar && npm run test:r10:qa` | R10 阶段回归测试 |
| **R10 责任边界检查** | `cd sidecar && npm run gate:r10-responsibility` | 检查模块职责边界 |
| **R10 契约快照检查** | `cd sidecar && npm run gate:r10-contract-snapshot` | 验证协议契约一致性 |
| **R10 文档索引检查** | `cd sidecar && npm run gate:r10-docs` | 验证文档完整性 |
| **R9 收口检查** | `cd sidecar && npm run gate:r9-closure` | R9 阶段收口验证 |
| **R11 命令边界检查** | `cd sidecar && npm run gate:r11-command-boundary` | 命令边界合规性 |
| **冒烟测试** | `cd sidecar && npm run smoke` | 端到端冒烟测试 |
| **Lint/Format** | 无明确配置 | 可能依赖 ESLint/Prettier（未发现配置文件） |

**关键脚本位置**：
- `sidecar/scripts/r10-responsibility-guard.js` - 责任边界检查
- `sidecar/scripts/r10-contract-snapshot-guard.js` - 契约快照检查
- `sidecar/scripts/r10-doc-index-guard.js` - 文档索引检查
- `sidecar/scripts/r9-closure-guard.js` - R9 收口检查
- `sidecar/scripts/r11-command-boundary-guard.js` - 命令边界检查

---

## 2) CI / Gate 现状

### 2.1 CI 配置

| CI 平台 | 配置文件 | 状态 |
|---------|----------|------|
| **GitHub Actions** | `.github/workflows/*.yml` | ❌ **缺失** |
| **其他 CI** | - | ❌ **缺失** |

**结论**: 当前**无 CI 配置**，依赖本地手动运行质量门禁脚本。

### 2.2 质量门禁（Gate）现状

| 门禁类型 | 脚本/命令 | 状态 | 说明 |
|---------|-----------|------|------|
| **复杂度/行数** | - | ❌ **缺失** | 无自动复杂度检查 |
| **循环依赖** | - | ❌ **缺失** | 无循环依赖检测 |
| **模块边界** | `gate:r10-responsibility` | ✅ 存在 | 检查模块职责边界 |
| **契约一致性** | `gate:r10-contract-snapshot` | ✅ 存在 | 验证协议契约快照 |
| **文档完整性** | `gate:r10-docs` | ✅ 存在 | 检查文档索引 |
| **命令边界** | `gate:r11-command-boundary` | ✅ 存在 | 命令边界合规性 |

### 2.3 Lint/Format 配置

| 工具 | 配置文件 | 状态 | 关键规则位置 |
|------|----------|------|-------------|
| **ESLint** | - | ❌ **缺失** | 无配置文件 |
| **Prettier** | - | ❌ **缺失** | 无配置文件 |
| **StyleCop** | - | ❌ **缺失** | 无 C# 代码风格检查 |
| **Roslyn Analyzers** | - | ❌ **缺失** | 无静态分析配置 |

**结论**: 代码风格与静态分析**完全依赖 IDE 默认配置**，无统一规范文件。

---

## 3) 大文件清单（LOC 统计）

### 3.1 统计规则

- **HARD 阈值**: LOC > 800
- **SOFT 阈值**: 400 < LOC <= 800
- **统计范围**: git tracked 的 `.cs` 和 `.js` 文件
- **排除**: `Library/`, `Temp/`, `node_modules/`, `bin/`, `obj/`, `dist/`, `build/`, `Generated/`, `*.min.*`

### 3.2 HARD 列表（LOC > 800，按预估 LOC 降序）

| 文件路径 | 预估 LOC | 语言 | 所属模块 | 是否测试文件 | 备注 |
|---------|---------|------|----------|------------|------|
| `sidecar/src/domain/validators.js` | ~4300 | JS | domain/验证 | ❌ | ⚠️ **最大文件**，职责过载 |
| `Assets/Editor/Codex/Application/ConversationController.cs` | ~3429 | C# | Application/控制器 | ❌ | ⚠️ **Unity 主控制器**，核心入口 |
| `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | ~2246 | C# | Infrastructure/执行器 | ❌ | ⚠️ **Action 执行器**，大量 primitive |
| `Assets/Editor/Codex/Domain/SidecarContracts.cs` | ~1594 | C# | Domain/DTO | ❌ | 协议 DTO 定义 |
| `sidecar/src/mcp/commands/index.js` | ~1235 | JS | mcp/命令中心 | ❌ | ⚠️ **命令定义中心**，单点耦合 |
| `sidecar/src/mcp/mcpServer.js` | ~723 | JS | mcp/入口 | ❌ | MCP JSON-RPC 服务器 |
| `sidecar/src/api/router.js` | ~358 | JS | api/路由 | ❌ | HTTP 路由分发 |

### 3.3 SOFT 列表（400 < LOC <= 800）

| 文件路径 | 预估 LOC | 语言 | 所属模块 | 是否测试文件 | 备注 |
|---------|---------|------|----------|------------|------|
| `sidecar/src/application/turnService.js` | ~700+ | JS | application/服务 | ❌ | 对话轮次服务 |
| `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs` | ~439 | C# | Infrastructure/注册 | ❌ | Action 注册引导 |
| `sidecar/src/application/mcpGateway/mcpGateway.js` | ~500+ | JS | application/网关 | ❌ | MCP 网关主类 |
| `sidecar/src/application/unityDispatcher/runtimeUtils.js` | ~500+ | JS | application/分发 | ❌ | Unity 请求构建工具 |

### 3.4 Top 30 最大文件总榜（预估）

| 排名 | 文件路径 | 预估 LOC | 语言 | 模块 |
|------|---------|---------|------|------|
| 1 | `sidecar/src/domain/validators.js` | ~4300 | JS | domain |
| 2 | `Assets/Editor/Codex/Application/ConversationController.cs` | ~3429 | C# | Application |
| 3 | `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | ~2246 | C# | Infrastructure |
| 4 | `Assets/Editor/Codex/Domain/SidecarContracts.cs` | ~1594 | C# | Domain |
| 5 | `sidecar/src/mcp/commands/index.js` | ~1235 | JS | mcp |
| 6 | `sidecar/src/mcp/mcpServer.js` | ~723 | JS | mcp |
| 7 | `sidecar/src/application/turnService.js` | ~700+ | JS | application |
| 8 | `sidecar/src/api/router.js` | ~358 | JS | api |
| 9 | `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs` | ~439 | C# | Infrastructure |
| 10+ | 其他文件 | <400 | - | - |

**注**: 由于无法直接执行文件行数统计命令，以上 LOC 基于文件读取与架构审计文档推断。实际统计需运行 `wc -l` 或类似工具。

---

## 4) 关键入口点与“中心化文件”定位

### 4.1 服务启动/入口

| 文件路径 | 类型 | 说明 | 被引用次数（推断） |
|---------|------|------|-------------------|
| `sidecar/src/index.js` | JS | Sidecar 主入口，启动 HTTP 服务器 | 1（直接启动） |
| `sidecar/src/mcp/mcpServer.js` | JS | MCP JSON-RPC 协议入口 | 高（MCP 客户端调用） |
| `Assets/Editor/Codex/Application/ConversationController.cs` | C# | Unity 主控制器，处理所有 Unity 侧请求 | 高（Unity Editor 生命周期） |

### 4.2 路由/分发中心

| 文件路径 | 类型 | 说明 | 为什么是中心点 |
|---------|------|------|---------------|
| `sidecar/src/api/router.js` | JS | HTTP 路由分发中心 | 所有 HTTP 请求首先经过此文件 |
| `sidecar/src/mcp/commandRegistry.js` | JS | MCP 命令注册表与分发 | 统一管理所有 MCP 命令的分发逻辑 |
| `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | C# | Unity Action 执行分发 | 所有 Visual Action 执行入口 |
| `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistry.cs` | C# | Unity Query 注册表与分发 | 所有 Query 请求的分发入口 |

### 4.3 注册中心

| 文件路径 | 类型 | 说明 | 为什么是中心点 |
|---------|------|------|---------------|
| `sidecar/src/mcp/commands/index.js` | JS | ⚠️ **MCP 命令定义中心** | 所有命令在此集中注册（`MCP_COMMAND_DEFINITIONS`） |
| `sidecar/src/mcp/commandRegistry.js` | JS | MCP 命令注册表实现 | 提供命令查找与分发能力 |
| `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistry.cs` | C# | Unity Action 注册表实现 | Action handler 的注册与查找 |
| `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs` | C# | ⚠️ **Action 注册引导中心** | 所有 Action 在此集中注册（`BuildDefaultRegistry`） |
| `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs` | C# | Query 注册引导中心 | 所有 Query handler 在此注册 |

### 4.4 验证中心

| 文件路径 | 类型 | 说明 | 为什么是中心点 |
|---------|------|------|---------------|
| `sidecar/src/domain/validators.js` | JS | ⚠️ **巨型验证器（4300+ 行）** | 所有请求/响应的验证逻辑集中于此 |
| `sidecar/src/mcp/commands/*/validator.js` | JS | 命令级验证器 | 各命令的独立验证逻辑（部分解耦） |

### 4.5 适配/桥接层

| 文件路径 | 类型 | 说明 | 为什么是中心点 |
|---------|------|------|---------------|
| `sidecar/src/application/unityDispatcher/runtimeUtils.js` | JS | Unity 请求构建工具 | 构建 Unity Action/Query 请求的桥接层 |
| `sidecar/src/application/turnPayloadBuilders.js` | JS | 轮次载荷构建器 | Legacy 字段与标准 `action_data` 的桥接 |
| `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs` | C# | HTTP 网关适配器 | Unity 与 Sidecar HTTP API 的适配层 |

---

## 5) 依赖与耦合画像（宏观雷达）

### 5.1 `sidecar/src/domain/validators.js` (HARD, ~4300 LOC)

| 维度 | 内容 |
|------|------|
| **主要 exports** | `validateMcpSubmitUnityTask`, `validateMcpApplyVisualActions`, `validateUnityActionResult`, `validateUnityCompileResult`, `validateTurnContextPayload`, `validateActionAnchorPolicyForKnownType`, `validateEnvelope`, `validateFileActionsApply`, `validateSelectionTreeNode`, `validateComponentDescriptorArray` |
| **主要 imports** | 无外部依赖（纯函数模块） |
| **主要被谁引用** | `sidecar/src/mcp/commandRegistry.js`, `sidecar/src/application/turnService.js`, `sidecar/src/application/mcpGateway/*.js` |
| **所属层级** | **domain**（领域层） |
| **跨层依赖** | ❌ 否（domain 层，无跨层依赖） |
| **循环依赖迹象** | ❌ 否 |
| **拆分建议** | 按域拆分：`validators-write.js`, `validators-read.js`, `validators-callback.js`, `validators-composite.js` |

### 5.2 `Assets/Editor/Codex/Application/ConversationController.cs` (HARD, ~3429 LOC)

| 维度 | 内容 |
|------|------|
| **主要 exports** | `ConversationController` 类（public 方法：`StartConversation`, `SendMessage`, `ExecutePendingActionAndReportAsync`, `ExecutePulledReadQueryAsync`） |
| **主要 imports** | `UnityAI.Editor.Codex.Domain.*`, `UnityAI.Editor.Codex.Infrastructure.*`, `UnityAI.Editor.Codex.Ports.*` |
| **主要被谁引用** | Unity Editor UI (`CodexChatWindow.cs`), 测试文件 |
| **所属层级** | **Application**（应用层） |
| **跨层依赖** | ✅ 是（Application 依赖 Infrastructure/Domain/Ports，符合分层） |
| **循环依赖迹象** | ❌ 否 |
| **拆分建议** | 按职责拆分：`ConversationController`（主流程）, `CompileStateTracker`, `SelectionSnapshotService`, `RagQueryPoller` |

### 5.3 `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` (HARD, ~2246 LOC)

| 维度 | 内容 |
|------|------|
| **主要 exports** | `UnityVisualActionExecutor` 类，大量 `RunXxx` primitive 方法（`RunAddComponent`, `RunRemoveComponent`, `RunReplaceComponent`, `RunCreateGameObject`, `RunSetTransform`, `RunSetRectTransform`, 等） |
| **主要 imports** | `UnityAI.Editor.Codex.Infrastructure.Actions.*`, `UnityAI.Editor.Codex.Domain.*` |
| **主要被谁引用** | `ConversationController.cs`（通过 `IUnityVisualActionExecutor` 接口） |
| **所属层级** | **Infrastructure**（基础设施层） |
| **跨层依赖** | ✅ 是（Infrastructure 依赖 Domain，符合分层） |
| **循环依赖迹象** | ❌ 否 |
| **拆分建议** | 将 primitive 下沉为独立服务：`TransformPrimitiveService`, `ComponentPrimitiveService`, `GameObjectPrimitiveService`，executor 仅负责 registry 与错误边界 |

### 5.4 `sidecar/src/mcp/commands/index.js` (HARD, ~1235 LOC)

| 维度 | 内容 |
|------|------|
| **主要 exports** | `MCP_COMMAND_DEFINITIONS`（命令定义数组） |
| **主要 imports** | 所有命令模块的 validator/handler（`get_action_catalog/validator`, `get_action_catalog/handler`, `capture_scene_screenshot/validator`, 等） |
| **主要被谁引用** | `sidecar/src/mcp/commandRegistry.js`（通过 `getMcpCommandRegistry()` 读取） |
| **所属层级** | **mcp**（MCP 协议层） |
| **跨层依赖** | ❌ 否（仅聚合命令模块） |
| **循环依赖迹象** | ❌ 否 |
| **拆分建议** | 改为“命令模块 manifest + loader”模式，`index.js` 仅扫描目录并聚合，不再手工维护数组 |

---

## 6) 变化热度（Hotspot）——为拆分优先级提供依据

### 6.1 Git 历史分析

**状态**: ⚠️ **无法获取**（原因：未检测到 git 仓库或 git 命令不可用）

**建议**: 如需获取变化热度，可运行：
```bash
git log --since="3 months ago" --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20
```

### 6.2 基于架构审计文档的推断热点

根据 `docs/ARCHITECTURE_AUDIT.md`，以下文件在近期重构中频繁变更：

| 文件路径 | 变更原因 | 备注 |
|---------|---------|------|
| `sidecar/src/mcp/commands/index.js` | R11 命令解耦阶段 | 新增命令需改此文件 |
| `sidecar/src/domain/validators.js` | R10 责任边界重构 | 职责过载，持续拆分中 |
| `sidecar/src/application/unityDispatcher/runtimeUtils.js` | Legacy 桥接移除 | Legacy anchor fallback 相关变更 |
| `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs` | Action 注册扩展 | 新增 Action 需改此文件 |
| `sidecar/src/ports/contracts.js` | 协议冻结清单 | 新增命令需同步此文件 |

---

## 7) “接口面”盘点（为 MCP 扩展与拆分边界服务）

### 7.1 Command/Action/Query 定义位置

| 类型 | 定义位置 | 注册机制 | 说明 |
|------|---------|---------|------|
| **MCP Command** | `sidecar/src/mcp/commands/<command_name>/validator.js` + `handler.js` | ⚠️ **手写清单**（`commands/index.js` 的 `MCP_COMMAND_DEFINITIONS`） | 每个命令独立目录，但需在中心文件注册 |
| **Unity Action** | `Assets/Editor/Codex/Infrastructure/Actions/*Handler.cs` | ⚠️ **手写清单**（`McpActionRegistryBootstrap.cs` 的 `BuildDefaultRegistry`） | Handler 类实现 `IMcpVisualActionHandler`，需在 Bootstrap 注册 |
| **Unity Query** | `Assets/Editor/Codex/Infrastructure/Queries/Handlers/*QueryHandler.cs` | ⚠️ **手写清单**（`UnityQueryRegistryBootstrap.cs` 的 `BuildDefaultRegistry`） | Handler 类实现 `IUnityQueryHandler`，需在 Bootstrap 注册 |

### 7.2 注册/发现机制

| 机制 | 实现方式 | 文件路径 | 问题 |
|------|---------|---------|------|
| **MCP Command 注册** | 中心化数组 + 手工 import | `sidecar/src/mcp/commands/index.js:81-1230` | ⚠️ **单点耦合**，新增命令必须改此文件 |
| **Unity Action 注册** | 静态构造函数 + 手工调用 | `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs:32-42` | ⚠️ **单点耦合**，新增 Action 必须改此文件 |
| **Unity Query 注册** | 静态构造函数 + 手工调用 | `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs:26-38` | ⚠️ **单点耦合**，新增 Query 必须改此文件 |
| **反射/扫描** | ❌ 无 | - | 无自动发现机制 |
| **Manifest** | ❌ 无 | - | 无 manifest 文件 |
| **Attributes** | ❌ 无 | - | C# 未使用特性标记 |

### 7.3 Schema/Contract/Validator 位置

| 类型 | 位置 | 说明 | 重复/不一致风险 |
|------|------|------|----------------|
| **MCP Tool Schema** | `sidecar/src/mcp/commandRegistry.js` (动态生成) | 从 `MCP_COMMAND_DEFINITIONS` 生成 | ⚠️ **多真相源**：定义在 `index.js`，冻结清单在 `contracts.js`，快照测试在 `r11-*.test.js` |
| **Action Schema** | `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistry.cs` (Capability) | `McpActionCapability.ActionDataSchemaJson` | ✅ 单一来源（Registry） |
| **Validator** | `sidecar/src/domain/validators.js` + `sidecar/src/mcp/commands/*/validator.js` | 全局验证器 + 命令级验证器 | ⚠️ **职责重复**：全局验证器与命令级验证器有重叠 |
| **Contract 冻结清单** | `sidecar/src/ports/contracts.js` | `ROUTER_PROTOCOL_FREEZE_CONTRACT`, `MCP_TOOL_VISIBILITY_FREEZE_CONTRACT` | ⚠️ **需手工同步**：新增命令需同时改 `index.js` 和 `contracts.js` |

### 7.4 不一致风险点

1. **MCP Command 多真相源**：
   - 定义：`commands/index.js`
   - 冻结清单：`contracts.js:110-194`
   - 快照测试：`tests/application/r11-command-contract-snapshot.test.js:67-117`
   - **风险**: 新增命令容易漏改，导致 tools/list 不可见

2. **Validator 职责重叠**：
   - 全局：`validators.js` 的 `validateMcpSubmitUnityTask`
   - 命令级：`commands/*/validator.js`
   - **风险**: 规则漂移，新增校验难定位

---

## 8) 现存架构审计/已知问题索引

### 8.1 架构审计文档

**主要文档**: `docs/ARCHITECTURE_AUDIT.md`

#### 8.1.1 Executive Summary（执行摘要）

- **整体扩展性评价**: 中（3/5）
- **最大风险 Top 1**: Command 多真相源（`commands/index.js` + `contracts.js` + 快照测试）
- **最大风险 Top 2**: Action legacy 桥接仍在主路径
- **最大风险 Top 3**: 错误码泛化兜底仍存在

#### 8.1.2 高风险文件名单（来自架构审计）

| 文件路径 | 风险类型 | 优先级 | 推荐动作 |
|---------|---------|--------|---------|
| `sidecar/src/mcp/commands/index.js` | 单点耦合 | **P0** | 改为“命令模块 manifest + loader”模式 |
| `sidecar/src/domain/validators.js` | 职责过载 | **P1** | 按域拆分（write/read/callback/composite） |
| `sidecar/src/application/unityDispatcher/runtimeUtils.js` | Legacy 桥接 | **P0** | 分阶段移除 legacy fallback |
| `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs` | 单点耦合 | **P1** | 拆分为多文件 registration module |
| `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | 巨型 primitive 容器 | **P1** | 将 primitive 下沉为独立服务 |

#### 8.1.3 推荐动作摘要

**Phase 1（先收敛 L2 命令与契约）**:
- 收敛 L2 命令“单一真相源”，把冻结清单改为生成物或 CI 自动校验
- 涉及文件：`commands/index.js`, `commandRegistry.js`, `contracts.js`, `router.js`, 快照测试

**Phase 2（Action 路径去 legacy + 模块化注册）**:
- 分阶段移除 legacy payload/anchor 桥接，统一 `action_data` + 标准 anchor
- 涉及文件：`runtimeUtils.js`, `turnPayloadBuilders.js`, `validators.js`, `McpActionRegistryBootstrap.cs`

**Phase 3（Query 载荷统一 + 错误码保真收口）**:
- 统一 query 载荷通道与错误码边界
- 涉及文件：`queryCoordinator.js`, `IUnityQueryHandler.cs`, `SidecarContracts.cs`

### 8.2 其他架构文档

| 文档路径 | 内容 | 状态 |
|---------|------|------|
| `docs/Codex-Unity-MCP-Extensibility-Decoupling-Execution-Blueprint.md` | 扩展解耦蓝图 | 参考 |
| `docs/Codex-Unity-MCP-Action-Governance-Upgrade-Blueprint.md` | Action 治理蓝图 | 参考 |
| `docs/Codex-Unity-MCP-Command-Development-Optimization-Blueprint.md` | Command 开发优化蓝图 | 参考 |
| `docs/Codex-Unity-MCP-Add-Action-Single-Path-Guide.md` | 新增 Action 唯一路径指南 | 参考 |

---

## 9) 输出结论：为了“后续精准拆分”，我还缺什么信息？

### 9.1 还需要补充的 5-10 条信息

1. **Git 历史变化热度**（无法获取）
   - 最近 3 个月变更次数最多的文件 Top 20
   - 每个文件的 insertions/deletions 统计
   - **获取方式**: `git log --since="3 months ago" --stat --oneline`

2. **精确的文件 LOC 统计**（无法获取）
   - 所有 `.cs` 和 `.js` 文件的确切行数
   - **获取方式**: `find . -name "*.cs" -o -name "*.js" | xargs wc -l | sort -rn`

3. **循环依赖检测结果**（无法获取）
   - JavaScript: `madge --circular sidecar/src`
   - C#: 静态分析工具（如 NDepend）
   - **获取方式**: 运行依赖分析工具

4. **测试覆盖率**（无法获取）
   - Sidecar 测试覆盖率（`npm run test -- --coverage`）
   - Unity EditMode 测试覆盖率
   - **获取方式**: 运行测试并生成覆盖率报告

5. **运行时依赖图**（无法获取）
   - 模块间的实际调用关系（通过代码分析或运行时追踪）
   - **获取方式**: 使用依赖分析工具或 APM

6. **性能热点**（无法获取）
   - 哪些文件/函数在运行时耗时最长
   - **获取方式**: 性能分析工具（Unity Profiler, Node.js --prof）

7. **代码复杂度指标**（无法获取）
   - 圈复杂度、认知复杂度
   - **获取方式**: `eslint --rule 'complexity: ["error", 10]'` 或类似工具

8. **外部依赖清单**（部分获取）
   - Sidecar: `npm list --depth=0`
   - Unity: `Packages/manifest.json`（已获取）
   - **获取方式**: 运行依赖分析命令

9. **代码注释率**（无法获取）
   - 每个文件的注释行数占比
   - **获取方式**: 代码分析工具

10. **团队变更历史**（无法获取）
    - 哪些文件由哪些开发者频繁修改
    - **获取方式**: `git log --format='%aN' --name-only | sort | uniq -c | sort -rn`

### 9.2 最值得先拆的 3 个 HARD 文件（理由）

#### 9.2.1 `sidecar/src/domain/validators.js` (~4300 LOC)

**理由**:
- **LOC**: 最大文件（4300+ 行）
- **耦合**: 被多个应用层模块引用，职责过载（write/read/callback/composite 验证混在一起）
- **被引用**: `commandRegistry.js`, `turnService.js`, `mcpGateway/*.js` 等多个文件
- **热度**: 架构审计文档明确标注为 P1 优先级，职责边界问题

**拆分建议**: 按域拆分为 `validators-write.js`, `validators-read.js`, `validators-callback.js`, `validators-composite.js`, `validators-core.js`（共享工具函数）

#### 9.2.2 `sidecar/src/mcp/commands/index.js` (~1235 LOC)

**理由**:
- **LOC**: HARD 阈值（1235 行）
- **耦合**: 单点耦合，所有命令定义集中于此，新增命令必须改此文件
- **被引用**: `commandRegistry.js` 直接依赖此文件的 `MCP_COMMAND_DEFINITIONS`
- **热度**: 架构审计文档标注为 P0 优先级，是“Command 多真相源”问题的核心

**拆分建议**: 改为“命令模块 manifest + loader”模式，`index.js` 仅扫描 `commands/` 目录并自动聚合，不再手工维护数组

#### 9.2.3 `Assets/Editor/Codex/Application/ConversationController.cs` (~3429 LOC)

**理由**:
- **LOC**: 第二大文件（3429 行）
- **耦合**: Unity 主控制器，处理所有 Unity 侧请求（Action/Query/Compile/Runtime Ping 等）
- **被引用**: Unity Editor UI 直接依赖，是 Unity 侧的核心入口
- **热度**: 虽然架构审计未明确标注，但文件过大，职责过多（对话管理、编译跟踪、选择快照、RAG 查询轮询等）

**拆分建议**: 按职责拆分为 `ConversationController`（主流程）、`CompileStateTracker`、`SelectionSnapshotService`、`RagQueryPoller`、`RuntimePingProbe` 等独立服务

---

## 附录：关键文件索引

### A.1 L2（Sidecar / MCP）关键文件

- `sidecar/src/mcp/mcpServer.js` - MCP JSON-RPC 入口
- `sidecar/src/api/router.js` - HTTP 路由分发
- `sidecar/src/mcp/commandRegistry.js` - 命令注册表
- `sidecar/src/mcp/commands/index.js` - ⚠️ 命令定义中心（单点耦合）
- `sidecar/src/application/turnService.js` - 对话轮次服务
- `sidecar/src/application/mcpGateway/mcpGateway.js` - MCP 网关
- `sidecar/src/domain/validators.js` - ⚠️ 巨型验证器（4300+ 行）
- `sidecar/src/ports/contracts.js` - 协议冻结契约

### A.2 L3（Unity）关键文件

- `Assets/Editor/Codex/Application/ConversationController.cs` - ⚠️ Unity 主控制器（3429 行）
- `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` - ⚠️ Action 执行器（2246 行）
- `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistry.cs` - Action 注册表
- `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs` - ⚠️ Action 注册引导（单点耦合）
- `Assets/Editor/Codex/Domain/SidecarContracts.cs` - 协议 DTO 定义
- `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistry.cs` - Query 注册表

---

**报告结束**
