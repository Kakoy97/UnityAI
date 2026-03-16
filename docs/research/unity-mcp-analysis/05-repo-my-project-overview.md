## Unity MCP 仓库总览（基于 UnityAI 本地工程）

## 1. 执行摘要

本仓库是一个**三层 Unity Editor 自动化栈**，围绕 MCP 协议、Node.js sidecar 网关、SSOT 工具字典与生成产物，以及 Unity Editor 执行层构建。整体上可以拆为四大部分：

- **L1：MCP Client（外部进程）**  
  通过 MCP STDIO 协议调用工具，本仓库只包含其对接面（`sidecar/src/mcp/mcpServer.js`），不包含 LLM 本体。
- **L2：Node.js Sidecar（外部进程）**  
  `sidecar/` 目录提供 HTTP + MCP Server、指令路由、SSOT 运行时、Block/Planner 路由、错误反馈与质量门禁，是整个运行时的「中枢网关」。
- **L3：Unity Editor 运行层（Unity 进程内）**  
  `Assets/Editor/Codex/` 目录下的 C# 代码负责对话控制、查询轮询、Unity API 调用和结果回传，是所有对场景/组件/资源的最终执行者。
- **SSOT 工具字典与编译链路**  
  `ssot/` 目录下的 `dictionary/tools.json` 与 `compiler/` 为单一真相源，生成 sidecar 用的 JSON Schema / MCP tools 清单，以及 Unity 侧 C# DTO/绑定代码。

主干运行时链路可以概括为：

> **MCP Client →（STDIO MCP）→ `UnityMcpServer` →（HTTP）→ Sidecar `TurnService` / SSOT Runtime →（HTTP）→ Unity Editor `ConversationController` / SSOT 执行器 → UnityEngine API → 回调结果 → 侧车 → MCP → LLM**

这一结构使得协议契约集中在 SSOT 与 sidecar，Unity 侧代码相对「薄」，并通过 Editor 轮询与回调实现了稳态闭环。

## 2. 目录结构与模块划分

### 2.1 顶层目录分层图

```text
UnityAI/
├── Assets/                             # Unity 工程主 Assets，含 Editor/C# 代码与 Demo 脚本
│   ├── Editor/
│   │   └── Codex/
│   │       ├── Application/            # 对话/轮询控制（L3 控制器层）
│   │       ├── Domain/                 # Sidecar 契约 DTO、聚合根
│   │       ├── Generated/
│   │       │   └── Ssot/               # 由 SSOT 生成的 L3 C# DTO/Bindings
│   │       ├── Infrastructure/         # Unity 侧基础设施（HTTP 网关、查询/写入执行器等）
│   │       ├── Ports/                  # L3 对 L2 的接口定义（Gateway/ProcessManager 等）
│   │       ├── Tests/                  # Unity EditMode 测试（查询/执行器/闭环测试）
│   │       └── UI/                     # `CodexChatWindow` 等 Editor UI
│   └── Scripts/                        # 示例场景脚本（Hello 按钮等）
├── sidecar/                            # L2 Node.js Sidecar 网关 & MCP Server
│   ├── src/
│   │   ├── mcp/                        # MCP Server（STDIO），工具暴露与治理
│   │   ├── api/                        # HTTP Router，将 HTTP 路径映射到 TurnService
│   │   ├── application/                # 业务运行层（TurnService、SSOT Runtime、Workflow、Metrics）
│   │   ├── domain/                     # 契约/验证/状态存储（TurnStore 等）
│   │   ├── infrastructure/             # HTTP Server 工厂、文件状态快照等
│   │   ├── adapters/                   # 进程参数解析、时间、文件写入等适配器
│   │   ├── ports/                      # 与 SSOT 产物的契约（contracts.js）
│   │   └── utils/                      # TURN 辅助工具、状态转换等
│   ├── scripts/                        # smoke/诊断/质量门禁脚本
│   ├── tests/                          # Node 层单测，覆盖 block runtime、SSOT、MCP 等
│   ├── index.js                        # Sidecar Node 进程入口
│   └── package.json                    # Node 侧依赖与脚本（含 ssot:build）
├── ssot/                               # SSOT 工具字典与编译产物
│   ├── dictionary/
│   │   ├── tools.json                  # 所有工具/家族定义的唯一真相源
│   │   └── dictionary.schema.json      # SSOT 字典 schema
│   ├── artifacts/
│   │   ├── l2/                         # 提供给 sidecar 的 JSON 产物
│   │   └── l3/                         # 提供给 Unity Editor 的 C# 产物
│   └── compiler/                       # Node 编译器，将 tools.json 编译为 L2/L3 产物
├── docs/                               # 本地架构/方案/研究文档
│   └── research/unity-mcp-analysis/    # 针对 Unity MCP 的分析文档（本文件位于此处）
├── Packages/                           # Unity package manifest（工程依赖）
├── ProjectSettings/                    # Unity 工程设置
└── README*.md                          # 根级说明文档（中英双语）
```

### 2.2 运行时相关模块定位（按关注点）

- **MCP server / transport（L1/L2 之间）**  
  - `sidecar/src/mcp/mcpServer.js`：实现 MCP STDIO server，处理 `initialize` / `tools/list` / `tools/call` 等方法，并进行工具可见性治理与入口治理（ENTRY_GOVERNANCE）。
  - `sidecar/src/mcp/commandRegistry.js`：统一注册 MCP 工具定义，从 SSOT 产物/本地静态定义组装工具列表与 HTTP route 映射。
  - `ssot/artifacts/l2/mcp-tools.generated.json`：SSOT 生成的 MCP 工具清单，作为 MCP 层「只读源」。

- **Sidecar HTTP router / Unity bridge（L2/L3 之间）**  
  - `sidecar/src/api/router.js`：负责 HTTP `method + path` → TurnService 的映射（`/health`、`/state/snapshot`、`/unity/*` 等），不承载业务规则。
  - `sidecar/src/infrastructure/serverFactory.js`：创建 HTTP Server 并挂载 router。
  - `sidecar/src/index.js`：将 `bootstrap()` 返回的 server 绑定到端口，是 Node sidecar 的真正入口。

- **Tool layer / SSOT runtime（契约/验证/调度）**  
  - `sidecar/src/application/ssotRuntime/index.js`：封装对 SSOT 产物的加载、Token Policy、Validator Registry、静态工具视图（action catalog/schema）等。
  - `sidecar/src/application/turnService.js`：Turn & query 的主调度器，集成缓存、token auto-issue/auto-retry、block pipeline、entry governance 等策略，并调用 SSOT/Block Runtime。
  - `ssot/compiler/*` 与 `ssot/dictionary/tools.json`：负责从工具字典编译 JSON Schema、MCP 工具清单和 C# DTO 绑定。

- **Unity bridge / tool executors（L3 Unity Editor 内）**  
  - `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`：Unity 侧 HTTP 客户端，负责调用 sidecar `/unity/*` 端点。
  - `Assets/Editor/Codex/Application/ConversationController.cs`：Editor 内核心控制器，管理 Sidecar 进程、请求生命周期、Compile gate、查询轮询等。
  - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/*.cs`：SSOT 生成/组织的具体执行器，例如 `CaptureSceneScreenshotSsotExecutor.cs`，将抽象 action 映射到 UnityEngine API。
  - `Assets/Editor/Codex/Infrastructure/Queries/*.cs`：Unity 查询注册表/分发（`UnityQueryRegistry`, `UnityQueryRegistryBootstrap`）。

- **Resource layer / Selection / Scene / Console 状态**  
  - `Assets/Editor/Codex/Infrastructure/UnitySelectionContextBuilder.cs`：构建 selection context，保证侧车看到的 selection/scene 视图稳定。
  - `Assets/Editor/Codex/Infrastructure/UnitySceneRevisionTracker.cs`：跟踪场景修订，配合 SSOT token/OCC。
  - `Assets/Editor/Codex/Infrastructure/UnityConsoleErrorTracker.cs`：采集 Console 错误用于 Compile gate 与 UI 提示。
  - `Assets/Editor/Codex/Infrastructure/Read/*`：包括 screenshot、UI 树、布局等 read service。

- **Screenshot 工具链**  
  - Sidecar 端：  
    - `ssot/dictionary/tools.json` 中声明 `capture_scene_screenshot` 类工具。  
    - `ssot/artifacts/l2/visibility-policy.generated.json`、`mcp-tools.generated.json` 暴露给 MCP。  
    - `sidecar/tests/domain/validators.capture-scene-screenshot.test.js`：对参数/锚点进行约束测试。
  - Unity 端：  
    - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/CaptureSceneScreenshotSsotExecutor.cs`：实际执行场景截图。  
    - `Assets/Editor/Codex/Infrastructure/Read/ScreenshotReadService.cs` / `UnityRagReadService.ScreenshotHelpers.cs`：为截图读取/处理提供帮助方法。

- **Batch execute / 批量执行（主要借鉴自 Unity MCP beta 文档部分）**  
  - 本项目自身的批量执行走 SSOT + block pipeline；在 `docs/unity-mcp-beta/` 中另有参考实现：  
    - `docs/unity-mcp-beta/MCPForUnity/Editor/Tools/BatchExecute.cs`：Unity 官方 MCP beta 中的批量执行工具示例。  
    - `sidecar/tests/application/ssot-batch-route.test.js`：验证 SSOT 层对批量路由的支持与约束（本项目中不直接暴露为 legacy BatchExecute 工具，而是统一走 planner/block 流程）。

- **Script handling / 脚本创建与编译工作流**  
  - Unity 端：  
    - `Assets/Editor/Codex/Infrastructure/UnityCompilationStateTracker.cs`：跟踪 Unity 编译状态与错误，用于 compile gate 决策。  
    - `Assets/Editor/Codex/Application/ConversationController.*.cs`：多个 partial 文件中承载脚本工作流（如自动创建脚本、等待编译、Attach 组件）的状态机与 UI 引导。
  - Sidecar 端：  
    - `sidecar/src/application/blockRuntime/*`：Planner block runtime，将「创建脚本 + 等待编译 + attach 组件」收敛为统一的 workflow（根据 repo 规则通过 `planner_execute_mcp` 与 `workflow.script.create_compile_attach` family key 进入）。

- **Screenshot / UI / 资源可视化辅助脚本**  
  - `sidecar/scripts/diagnose-capture.js`：对截图及捕获链路进行诊断的脚本。  
  - `sidecar/scripts/mcp-visual-anchor-regression.js`：针对 UI/视觉锚点的回归脚本，帮助验证截图/overlay/锚点稳定性。

## 3. 运行时组成

### 3.1 进程与边界

- **MCP Client 进程（Cursor / 其他 MCP host）**  
  - 不在仓库内，但通过 STDIO 与 `sidecar/src/mcp/mcpServer.js` 通信。  
  - **只知道 MCP tools schema 与结果 JSON，不了解 Unity/HTTP 细节。**

- **Node.js Sidecar 进程**  
  - 入口：`sidecar/index.js` → `sidecar/src/index.js.bootstrap()`。  
  - 责任：
    - MCP server（tools list/call，入口治理、可见性策略）  
    - HTTP server（/health、/state/snapshot、/mcp/*、/unity/* 等）  
    - Turn/Query 调度（`TurnService`）  
    - SSOT runtime（字典编译产物加载、schema 验证、token policy）  
    - Block/Planner runtime（多步事务、verify/recovery hooks、visibility profile）  
    - 错误反馈与 UX 指南（`mcpErrorFeedbackTemplates.json`）

- **Unity Editor 进程（C#）**  
  - 入口：
    - `[InitializeOnLoad] UnityRagQueryPollingBootstrap`：在 Editor 启动时 new 一个共享 `ConversationController`，并挂到 `EditorApplication.update`。  
    - `CodexChatWindow` 菜单：`Tools/Codex/Chat MVP` 打开对话窗口，驱动 Onboarding、Health 检查和 compile gate 按钮。
  - 责任：
    - 从 EditorPrefs 恢复 sidecar URL / thread id / 上一次状态  
    - 周期性拉取 sidecar query 与任务状态（轮询）  
    - 将 selection/scene/console 状态上报给 sidecar  
    - 根据 SSOT/Block runtime 的请求，在主线程执行 UnityEngine API，并将结果回写。

### 3.2 运行时分层图（文字）

从「调用路径」视角，可以抽象为：

- **上游交互层（L1）**：MCP Client（LLM / IDE）  
  - 发起 `tools/call` → 以 family key / tool name 表达需求（如「capture scene screenshot」「query prefab info」）。

- **协议与编排层（L2 sidecar）**  
  - **协议适配**：MCP STDIO Server 将 tools 调用转为内部 command / HTTP route。  
  - **契约映射**：通过 SSOT 产物查到对应 HTTP route、schema、token policy。  
  - **调度与门禁**：`TurnService` 决定是否需要新的 read-token、事务包装、verify/recovery hooks；Block runtime 将多步写操作组织成事务。  
  - **Unity 桥接**：对 Unity 的「写操作」以 `/unity/action.request` 形式排队，读操作通过 `/unity/query/pull` 拉取，再由 Unity 轮询执行。

- **执行与反馈层（L3 Unity Editor）**  
  - **轮询与心跳**：`UnityRagQueryPollingBootstrap` 周期性拉取 query / action，并上报 selection/runtime 状态。  
  - **上下文构建**：Selection、Scene Revision、Console Errors 被封装为统一 context，供 SSOT 执行器/查询处理使用。  
  - **工具执行**：SSOT Executors / Queries 根据工具 family 将抽象动作/查询映射到 UnityEngine API。  
  - **结果回写**：通过 `/unity/*` 回传结果，最终经 sidecar → MCP → 返回到 L1。

## 4. 核心入口文件

下面列出当前工程中**最核心、对主干链路影响最大**的 10~20 个文件，并简要说明：

1. **`README.md` / `README.zh-CN.md` / `README.en.md`（根目录）**  
   - 提供三层架构总览、目录结构说明和基本启动方式，是理解工程的首选入口。

2. **`sidecar/package.json`**  
   - 定义 `npm start`、`ssot:build`、`mcp:server`、`mcp:setup-cursor` 等脚本，串联「先构建 SSOT → 再启动 sidecar → 启动 MCP Server」的一整套开发/运行流程。

3. **`sidecar/index.js`**  
   - Node sidecar 的进程入口：解析端口参数、调用 `src/index.bootstrap()` 启动 HTTP Server 与 TurnService，并绑定 `SIGINT` 关闭逻辑。

4. **`sidecar/src/index.js`**  
   - sidecar 应用级入口：检查 SSOT 产物可用性（`assertSsotArtifactsAvailable`），构造 `TurnStore`/`TurnService`，创建 HTTP server，是 L2 层「单点总线」。

5. **`sidecar/src/api/router.js`**  
   - HTTP 路由器：将 `/health`、`/state/snapshot`、`/unity/*`、`/mcp/capabilities` 等路径映射到 `TurnService` 或 MCP Command Registry，是 L2 与 L3 的 HTTP 接缝。

6. **`sidecar/src/mcp/mcpServer.js`**  
   - MCP STDIO Server：实现 `initialize`、`tools/list`、`tools/call`，并通过 visibility/entry governance 限制哪些工具对 MCP 暴露，是 L1 与 L2 的协议边界。

7. **`sidecar/src/mcp/commandRegistry.js`**  
   - MCP 工具注册中心：从命令定义集合构建工具列表、HTTP route 映射、输入 schema 模板，是「工具视图」与「HTTP 路由」之间的桥梁。

8. **`sidecar/src/application/turnService.js`**  
   - Turn/Query 的业务中枢：管理 read-token、缓存、超时、token auto-issue/auto-retry、block pipeline 与 Unity query pipeline，是 sidecar 内部的「心脏」。

9. **`ssot/dictionary/tools.json`**  
   - SSOT 字典：定义所有工具 family、输入输出结构和策略元数据，是 L2/L3 代码生成与运行时验证的唯一真相源。

10. **`ssot/compiler/index.js`**  
    - SSOT 编译器入口：读取 `tools.json`，生成 L2 JSON（`mcp-tools.generated.json` 等）和 L3 C# 产物，是契约从「设计」迈向「可执行」的关键工具。

11. **`ssot/artifacts/l2/mcp-tools.generated.json`**  
    - MCP 工具清单：提供给 MCP Server / sidecar 的静态 tools 描述，确保 L1/L2 对齐在同一个契约快照上。

12. **`ssot/artifacts/l3/SsotDtos.generated.cs` / `SsotDispatchBindings.generated.cs`**  
    - Unity 侧 DTO 与 dispatch 绑定：提供强类型的参数/结果结构与工具绑定，避免 Unity 端出现「自由 JSON」。

13. **`Assets/Editor/Codex/Infrastructure/UnityRagQueryPollingBootstrap.cs`**  
    - Unity Editor 启动入口：通过 `[InitializeOnLoad]` 初始化共享 `ConversationController`，并将轮询/selection 变更挂到 `EditorApplication.update` / `Selection.selectionChanged`。

14. **`Assets/Editor/Codex/Application/ConversationController.cs`（及其 partial 文件）**  
    - Unity 端主控制器：管理 Sidecar 启停、线程/请求状态、编译门禁、轮询与日志，是 L3 层的「控制中枢」。

15. **`Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`**  
    - Unity → Sidecar HTTP 网关：负责构造 `/unity/*` 请求和解析响应，是 Unity 与 Node 之间的唯一网络出口。

16. **`Assets/Editor/Codex/Infrastructure/Ssot/Executors/CaptureSceneScreenshotSsotExecutor.cs`**  
    - 代表性 SSOT 执行器：展示 SSOT 工具如何在 Unity 内被「落地」为实际 API 调用，也是截图类工具的关键实现。

17. **`Assets/Editor/Codex/Infrastructure/UnitySceneRevisionTracker.cs` / `UnitySelectionContextBuilder.cs`**  
    - 保证 selection/scene 状态与 SSOT token/OCC 对齐的关键基础设施，直接影响写操作的安全性与「感觉顺畅度」。

18. **`Assets/Editor/Codex/UI/CodexChatWindow.cs`**  
    - Unity Editor 侧 UI 入口：通过菜单打开 Chat 窗口，承载 sidecar 启停、MCP onboarding、编译状态展示等人机交互。

19. **`docs/UnityAI架构与功能说明文档.md`**  
    - 对三层架构、通信链路、门禁/Schema 策略做了系统性描述，是本仓库内部的「架构白皮书」。

20. **`docs/research/unity-mcp-analysis/02-runtime-callflow.md`**  
    - 从 Unity MCP 官方实现出发，梳理了 runtime 调用流，并与本项目做对照，为理解当前实现的设计取舍提供参考。

## 5. 主干调用链初步判断

从实际源码与目录结构看，本工程的「主干运行时链路」可以抽象为以下几个步骤：

1. **MCP 工具调用与入口治理（L1 → L2）**  
   - LLM / IDE 通过 MCP STDIO 调用某个工具（如 `capture_scene_screenshot` 或 planner family key）。  
   - `UnityMcpServer` 根据 visibility/entry governance 判断工具是否可见/可调用，并通过 `McpCommandRegistry` 找到对应工具契约与 HTTP 路由。

2. **SSOT 与 Block Runtime 端的编排（L2 内部）**  
   - `TurnService` 根据 tools 契约和 SSOT 产物决定：  
     - 是否需要新的 read-token（OCC）  
     - 是否需要将多个写操作包裹进事务（`write.transaction.execute`）  
     - 是否需要 verify/recovery hooks  
   - 对读类查询，通常会通过 SSOT query runtime + Unity query pipeline 获取结果；对写类操作，通过 `/unity/action.request` 提交到 Unity。

3. **Unity Editor 执行与状态上报（L2 ↔ L3）**  
   - Unity 侧的 `UnityRagQueryPollingBootstrap` 周期性调用 `ConversationController.PollRagQueriesAsync`，拉取待处理的 action/query。  
   - `ConversationController` 结合 `UnitySelectionContextBuilder`、`UnitySceneRevisionTracker`、`UnityConsoleErrorTracker` 等，构建上下文并调用具体的 SSOT Executor / Query Handler。  
   - 执行完成后，通过 `/unity/query/report`、`/unity/action/result` 等 HTTP 端点回写至 sidecar。

4. **结果归并与反馈（L2 → L1）**  
   - Sidecar 收到 Unity 回调后更新 `TurnStore` / token 状态，通过 MCP Server 将最终结果打包为 MCP tool result 返回给 L1。  
   - 若过程出现 schema/契约错误或 OCC 冲突，将根据 `mcpErrorFeedbackTemplates.json` 生成可读错误与修复建议。

整体来看，**主干链路严格遵守「MCP → sidecar → SSOT/Block → Unity → sidecar → MCP」** 的顺序，避免任何层级跨越调用（例如 Unity 直接感知 MCP，或 MCP 直接操作 Unity）。

## 6. 初步结论

基于当前仓库结构与入口文件的粗略分析，可以做出如下**初步判断**（不展开论证，仅做记录）：

- **为什么这个项目比一般 Unity AI 工具「更顺」：**
  - 运行时职责拆分清晰：MCP、sidecar、Unity Editor 各自只做一层的事情，上下层依赖通过 SSOT 产物与 HTTP/MCP 协议桥接，减少了「乱穿」的耦合。  
  - 契约集中在 SSOT：工具定义与 schema 只在 `tools.json` 这一处维护，L2/L3 通过编译产物共享同一版本的真相，避免了典型「C#/Node/LLM 三份定义不一致」的问题。  
  - 强治理的入口与可见性策略：MCP Server 对工具曝光与入口模式（planner-first、direct compatibility）有比较严格的门禁，限制了「野生直连」路径，让调用路径更可控。  
  - Unity 端保持「薄执行层」：大部分复杂逻辑（事务、OCC、retry、workflow）都留在 Node/SSOT 层，Unity 代码更多是「上下文构建 + 安全执行」，减少了在 Editor 里 debug 复杂状态机的成本。

后续如需深入，可以分别对：Block Runtime、事务/恢复链路、脚本工作流（create + compile + attach）、UI/截图工具族等做专项深挖与对齐分析。

