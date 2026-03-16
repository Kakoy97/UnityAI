# Unity MCP 仓库总览

**版本：** v1.0  
**分析日期：** 2026-03-06  
**分析范围：** 仓库总览 + 模块地图（非全量深挖）  
**项目版本：** Server v9.5.3, Unity Package v9.5.4-beta.3

---

## 1. 执行摘要

Unity MCP（MCP for Unity）是一个基于 Model Context Protocol (MCP) 的 Unity Editor 自动化框架，允许 AI 助手（Claude、Cursor、VS Code 等）通过自然语言控制 Unity Editor。

**核心架构特点：**
- **双进程架构**：Python MCP Server（外部进程） + Unity Editor Plugin（Unity 内）
- **多传输协议**：支持 HTTP（WebSocket）和 stdio 两种传输方式
- **插件化设计**：工具和资源通过装饰器自动注册
- **批处理优化**：`batch_execute` 工具实现 10-100x 性能提升
- **厚工具设计**：单个工具处理完整工作流，减少工具数量

**版本信息：**
- Server: v9.5.3 (`Server/pyproject.toml`)
- Unity Package: v9.5.4-beta.3 (`MCPForUnity/package.json`)
- 要求：Unity 2021.3 LTS+, Python 3.10+, uv/uvx
- 默认端口：`http://localhost:8080`（HTTP 模式）

---

## 2. 目录结构与模块划分

### 2.1 顶层目录结构

```
unity-mcp-beta/
├── Server/                    # Python MCP Server（外部进程）
│   ├── src/                   # 服务端源码
│   │   ├── main.py           # 服务端入口（FastMCP）
│   │   ├── cli/              # CLI 命令行工具
│   │   ├── core/              # 核心配置、日志、遥测
│   │   │   ├── config.py     # 配置管理
│   │   │   ├── telemetry.py  # 遥测系统
│   │   │   └── constants.py  # 常量定义
│   │   ├── models/            # 数据模型
│   │   │   ├── models.py     # MCP 响应模型
│   │   │   └── unity_response.py  # Unity 响应模型
│   │   ├── services/          # 业务服务层
│   │   │   ├── registry/      # 工具/资源注册表
│   │   │   │   ├── tool_registry.py      # 工具注册机制（装饰器）
│   │   │   │   └── resource_registry.py   # 资源注册机制（装饰器）
│   │   │   ├── resources/     # MCP 资源实现（20个）
│   │   │   │   ├── editor_state.py
│   │   │   │   ├── project_info.py
│   │   │   │   ├── gameobject.py
│   │   │   │   └── ...
│   │   │   ├── tools/         # MCP 工具实现（33个）
│   │   │   │   ├── batch_execute.py       # 批处理工具
│   │   │   │   ├── manage_gameobject.py   # GameObject 管理
│   │   │   │   ├── manage_scene.py        # 场景管理
│   │   │   │   ├── manage_script.py       # 脚本管理
│   │   │   │   ├── manage_ui.py           # UI 管理
│   │   │   │   └── ...
│   │   │   ├── api_key_service.py
│   │   │   └── custom_tool_service.py
│   │   └── transport/         # 传输层
│   │       ├── unity_transport.py         # Unity 命令路由
│   │       ├── plugin_hub.py              # 插件中心（WebSocket Hub）
│   │       ├── plugin_registry.py         # 插件注册表
│   │       └── unity_instance_middleware.py  # Unity 实例中间件
│   ├── pyproject.toml         # Python 项目配置
│   └── README.md
│
├── MCPForUnity/               # Unity Editor 插件（Unity 内运行）
│   ├── Editor/                # Editor 脚本（519个文件）
│   │   ├── Clients/           # MCP 客户端配置器（Cursor/VS Code/Claude Code等）
│   │   │   ├── Configurators/ # 各客户端配置器实现
│   │   │   └── McpClientRegistry.cs
│   │   ├── Services/          # Unity 侧服务层
│   │   │   ├── Transport/     # 传输实现
│   │   │   │   ├── TransportManager.cs
│   │   │   │   ├── TransportCommandDispatcher.cs  # 主线程调度器
│   │   │   │   └── Transports/
│   │   │   │       ├── WebSocketTransportClient.cs  # WebSocket 客户端
│   │   │   │       └── StdioTransportClient.cs      # Stdio 客户端
│   │   │   ├── Server/        # 服务器管理
│   │   │   ├── BridgeControlService.cs
│   │   │   ├── ToolDiscoveryService.cs
│   │   │   ├── ResourceDiscoveryService.cs
│   │   │   └── TestRunnerService.cs
│   │   ├── Tools/             # Unity 侧工具实现（74个 .cs）
│   │   │   ├── BatchExecute.cs              # 批处理执行器
│   │   │   ├── CommandRegistry.cs            # 命令注册表（反射发现）
│   │   │   ├── ManageScript.cs               # 脚本管理
│   │   │   ├── ManageScene.cs                # 场景管理
│   │   │   ├── GameObjects/                  # GameObject 操作
│   │   │   ├── Animation/                    # 动画工具
│   │   │   ├── Graphics/                     # 图形工具
│   │   │   ├── Vfx/                          # 视觉效果工具
│   │   │   └── ...
│   │   ├── Windows/           # Editor 窗口 UI（UXML/USS）
│   │   │   ├── MCPForUnityEditorWindow.cs    # 主窗口
│   │   │   └── Components/                    # UI 组件
│   │   ├── Helpers/           # 辅助工具类
│   │   └── Resources/         # 资源实现
│   ├── Runtime/               # Runtime 脚本（2个 .cs）
│   └── package.json           # Unity Package 配置
│
├── TestProjects/              # 测试项目
│   ├── UnityMCPTests/         # 单元测试
│   └── AssetStoreUploads/     # Asset Store 发布包
│
├── docs/                      # 文档
│   ├── development/          # 开发文档
│   ├── guides/               # 使用指南
│   └── research/             # 研究文档
│
├── tools/                     # 工具脚本（版本管理、发布等）
├── manifest.json              # MCP manifest（工具/资源清单）
├── mcp_source.py              # Unity package 源切换工具
└── README.md                  # 项目主 README
```

### 2.2 核心模块目录详解

#### Server 端（Python）

**`Server/src/main.py`** - MCP Server 入口
- 初始化 FastMCP 服务器
- 注册工具和资源（通过装饰器自动发现）
- 配置传输层（HTTP/stdio）
- 管理 Unity 连接池（PluginHub）
- 启动 HTTP Server（默认 `localhost:8080`）

**`Server/src/services/tools/`** - 工具实现层（33个工具）
- `batch_execute.py` - 批处理执行（Server 侧验证和路由）
- `manage_gameobject.py` - GameObject 操作（创建、删除、修改、查询）
- `manage_scene.py` - 场景管理（创建、加载、保存、层级查询）
- `manage_script.py` - 脚本管理（创建、删除、编辑）
- `manage_ui.py` - UI 管理（UI Toolkit 操作）
- `manage_material.py` - 材质管理
- `manage_animation.py` - 动画控制
- `manage_graphics.py` - 图形渲染
- `manage_camera.py` - 相机管理
- `manage_packages.py` - 包管理
- 等等...

**`Server/src/services/resources/`** - 资源实现层（20个资源）
- `editor_state.py` - 编辑器状态（编译状态、就绪状态等）
- `project_info.py` - 项目信息
- `gameobject.py` - GameObject 详情
- `prefab_info.py` - Prefab 信息
- `cameras.py` - 相机列表
- `volumes.py` - Volume 列表
- `rendering_stats.py` - 渲染统计
- 等等...

**`Server/src/transport/`** - 传输层
- `unity_transport.py` - Unity 命令路由（`send_with_unity_instance`）
- `plugin_hub.py` - 插件中心（WebSocket Hub，管理连接、命令分发）
- `plugin_registry.py` - 插件注册表（Unity 实例注册/发现）
- `unity_instance_middleware.py` - Unity 实例中间件（多实例路由）

#### Unity 端（C#）

**`MCPForUnity/Editor/Services/Transport/Transports/WebSocketTransportClient.cs`** - Unity 传输层
- WebSocket 客户端（主要传输方式）
- 连接管理、重连机制（重试计划：[0s, 1s, 3s, 5s, 10s, 30s]）
- Keep-alive / 心跳机制
- 注册消息发送（project_name, project_hash, unity_version）

**`MCPForUnity/Editor/Services/Transport/TransportCommandDispatcher.cs`** - 命令调度器
- 确保 Unity API 调用在主线程执行
- `RequestMainThreadPump()` - 唤醒主线程
- `ProcessQueue()` - 处理命令队列（EditorApplication.update 回调）

**`MCPForUnity/Editor/Tools/CommandRegistry.cs`** - 命令注册表
- 反射查找 `[McpForUnityTool]` 标记的类
- 自动发现工具和资源
- `ExecuteCommand()` - 执行命令（同步/异步）

**`MCPForUnity/Editor/Tools/BatchExecute.cs`** - 批处理执行器
- Unity 侧批量命令执行（10-100x 性能提升）
- 在主线程顺序执行，保证 Unity API 安全
- 默认最大 25 个命令，硬上限 100
- 支持 `failFast` 模式

**`MCPForUnity/Editor/Tools/ManageScript.cs`** - 脚本管理
- 创建脚本、删除脚本、应用编辑
- 编译等待机制（`RefreshUnity.cs`）
- 文件操作（写入、刷新、触发编译）

**`MCPForUnity/Editor/Windows/MCPForUnityEditorWindow.cs`** - Editor UI
- 主窗口（`Window > MCP for Unity`）
- 服务器状态、Unity Bridge、MCP Client 配置、工具管理
- 实时工具切换、批量设置

---

## 3. 运行时组成

### 3.1 运行时架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Client Layer                           │
│  (Claude Desktop / Cursor / VS Code / Claude Code / etc.)   │
└──────────────────────┬──────────────────────────────────────┘
                       │ MCP Protocol (HTTP/stdio)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                  MCP Server Layer (Python)                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ FastMCP Framework                                      │ │
│  │  - Tool Registry (33 tools via @mcp_for_unity_tool)   │ │
│  │  - Resource Registry (20 resources)                    │ │
│  │  - Transport Router (HTTP/stdio)                       │ │
│  └──────────────┬─────────────────────────────────────────┘ │
│                 │ Unity Instance Middleware                  │
│                 │  - 多实例路由（Name@hash）                │
│  ┌──────────────▼─────────────────────────────────────────┐ │
│  │ Unity Transport Layer (unity_transport.py)             │ │
│  │  - send_with_unity_instance()                          │ │
│  └──────────────┬─────────────────────────────────────────┘ │
│                 │ Plugin Hub (WebSocket)                    │
│                 │  - 连接管理 / 命令分发                     │
│                 │  - 等待重连（最多 20s，domain reload）    │
│                 │  - 快速失败（关键命令 2s 超时）           │
└─────────────────┼───────────────────────────────────────────┘
                  │ WebSocket (ws://localhost:8080/hub/plugin)
                  │
┌─────────────────▼───────────────────────────────────────────┐
│            Unity Bridge Layer (C# Editor Plugin)             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ WebSocketTransportClient                              │ │
│  │  - 连接管理 / 重连机制                                │ │
│  │  - Keep-alive / 心跳                                  │ │
│  │  - 注册消息（project_name, project_hash）            │ │
│  └──────────────┬─────────────────────────────────────────┘ │
│                 │ TransportCommandDispatcher                │
│                 │  - 主线程调度                             │
│                 │  - RequestMainThreadPump()                │
│                 │  - ProcessQueue()                         │
└─────────────────┼───────────────────────────────────────────┘
                  │ Unity Editor API
                  │
┌─────────────────▼───────────────────────────────────────────┐
│              Unity Editor Runtime                            │
│  - Scene Management                                          │
│  - Asset Management                                          │
│  - Script Compilation                                        │
│  - GameObject Operations                                     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 运行环境划分

| 组件 | 运行环境 | 技术栈 | 入口文件 |
|------|---------|--------|---------|
| **MCP Server** | 外部进程（Python） | Python 3.10+, FastMCP, FastAPI | `Server/src/main.py` |
| **HTTP Server** | 外部进程（Python） | FastAPI, Uvicorn | `Server/src/main.py`（FastMCP 内置） |
| **Unity Bridge** | Unity Editor 内 | C# (.NET), Unity Editor API | `MCPForUnity/Editor/Services/Transport/Transports/WebSocketTransportClient.cs` |
| **MCP Client** | 外部进程（AI 助手） | 各客户端实现 | 由用户配置 |

### 3.3 传输协议

**HTTP 传输（推荐）：**
- Server 端：FastMCP HTTP Server（默认 `localhost:8080`）
- Unity 端：WebSocket 连接到 `/hub/plugin`
- 优势：支持远程部署、多实例、API Key 认证

**Stdio 传输（传统）：**
- Server 端：标准输入/输出
- Unity 端：StdioBridgeHost（进程管道）
- 优势：简单、无需网络配置

---

## 4. 核心入口文件

### 4.1 Server 端核心文件（10个）

| 文件路径 | 作用 |
|---------|------|
| `Server/src/main.py` | **MCP Server 主入口**：初始化 FastMCP、注册工具/资源、启动传输层 |
| `Server/src/transport/unity_transport.py` | **传输路由层**：将 MCP 工具调用路由到 Unity 实例 |
| `Server/src/transport/plugin_hub.py` | **插件中心**：管理 WebSocket 连接、命令分发、等待重连 |
| `Server/src/transport/plugin_registry.py` | **插件注册表**：Unity 实例注册/发现 |
| `Server/src/services/registry/tool_registry.py` | **工具注册机制**：装饰器自动注册工具（`@mcp_for_unity_tool`） |
| `Server/src/services/registry/resource_registry.py` | **资源注册机制**：装饰器自动注册资源 |
| `Server/src/services/tools/batch_execute.py` | **批处理工具**：Server 侧批处理逻辑（验证、路由） |
| `Server/src/services/tools/manage_gameobject.py` | **GameObject 工具**：厚工具设计示例 |
| `Server/src/services/resources/editor_state.py` | **编辑器状态资源**：提供编译状态、就绪状态等 |
| `Server/src/core/config.py` | **配置管理**：环境变量、CLI 参数解析 |

### 4.2 Unity 端核心文件（10个）

| 文件路径 | 作用 |
|---------|------|
| `MCPForUnity/Editor/Services/Transport/Transports/WebSocketTransportClient.cs` | **WebSocket 传输客户端**：连接 MCP Server、命令接收/发送 |
| `MCPForUnity/Editor/Services/Transport/TransportCommandDispatcher.cs` | **命令调度器**：确保 Unity API 调用在主线程执行 |
| `MCPForUnity/Editor/Tools/BatchExecute.cs` | **批处理执行器**：Unity 侧批量命令执行（10-100x 性能提升） |
| `MCPForUnity/Editor/Tools/CommandRegistry.cs` | **命令注册表**：Unity 工具注册中心（反射发现） |
| `MCPForUnity/Editor/Tools/ManageScript.cs` | **脚本管理工具**：创建、删除、编辑脚本，编译等待 |
| `MCPForUnity/Editor/Tools/ManageScene.cs` | **场景管理工具**：场景操作、层级查询 |
| `MCPForUnity/Editor/Services/BridgeControlService.cs` | **Bridge 控制服务**：启动/停止 Unity Bridge |
| `MCPForUnity/Editor/Services/ServerManagementService.cs` | **服务器管理服务**：启动/管理 MCP Server 进程 |
| `MCPForUnity/Editor/Services/ToolDiscoveryService.cs` | **工具发现服务**：扫描并注册可用工具 |
| `MCPForUnity/Editor/Windows/MCPForUnityEditorWindow.cs` | **Editor 窗口**：主 UI 入口（Window > MCP for Unity） |

---

## 5. 主干调用链初步判断

### 5.1 MCP 工具调用链路

```
1. MCP Client (Cursor/Claude)
   └─> HTTP POST /mcp (JSON-RPC) 或 stdio
       │
2. FastMCP Server (main.py)
   └─> Tool Registry 查找工具
       └─> @mcp_for_unity_tool 装饰的函数
           │
3. Unity Instance Middleware
   └─> 解析 unity_instance (Name@hash / hash / port)
       └─> 注入到 ctx.state["unity_instance"]
           │
4. Unity Transport Layer (unity_transport.py)
   └─> send_with_unity_instance()
       └─> PluginHub.send_command_for_instance()
           │
5. Plugin Hub (plugin_hub.py)
   └─> _resolve_session_id() (可能等待重连，最多 20s)
       └─> _ensure_live_connection() (连接存活检查)
           └─> send_command() (WebSocket 发送)
               │
6. Unity Bridge (WebSocketTransportClient.cs)
   └─> 接收 WebSocket 消息
       └─> TransportCommandDispatcher.ExecuteCommandJsonAsync()
           │
7. Transport Command Dispatcher
   └─> RequestMainThreadPump() (唤醒主线程)
       └─> ProcessQueue() (EditorApplication.update 回调)
           └─> CommandRegistry.ExecuteCommand()
               │
8. Unity Tool Handler (Tools/*.cs)
   └─> HandleCommand() 方法
       └─> Unity Editor API 调用
           │
9. 响应返回
   └─> WebSocket 回传 → Plugin Hub → FastMCP → MCP Client
```

### 5.2 批处理执行链路（性能优化关键）

```
1. MCP Client 调用 batch_execute
   └─> { "commands": [{"tool": "...", "params": {...}}, ...] }
       │
2. Server: services/tools/batch_execute.py
   └─> 验证命令数量（默认最大 25，硬上限 100）
       └─> 发送单个 batch_execute 命令到 Unity
           │
3. Unity: Tools/BatchExecute.cs
   └─> HandleCommand() 在主线程顺序执行
       ├─> 遍历 commands 数组
       ├─> 每个命令调用 CommandRegistry.InvokeCommandAsync()
       ├─> 收集结果（支持 failFast 模式）
       └─> 返回批量结果数组
           │
4. 性能提升原因：
   - 单次 WebSocket 往返 vs N 次往返
   - Unity 侧批量执行减少上下文切换
   - 主线程顺序执行保证 Unity API 安全
```

### 5.3 Unity Bridge 启动链路

```
1. Unity Editor: Window > MCP for Unity
   └─> MCPForUnityEditorWindow 打开
       │
2. 用户点击 "Start Bridge"
   └─> BridgeControlService.StartBridgeAsync()
       │
3. TransportManager 选择传输方式
   ├─> HTTP: WebSocketTransportClient.StartAsync()
   │   └─> 连接到 ws://localhost:8080/hub/plugin
   │       └─> 发送注册消息（project_name, project_hash, unity_version）
   │
   └─> Stdio: StdioBridgeHost.StartAsync()
       └─> 启动子进程，建立管道
           │
4. Plugin Hub 接收注册
   └─> PluginRegistry.register_instance()
       └─> Unity 实例加入连接池
```

---

## 6. 初步结论

### 6.1 架构优势分析

**为什么这个项目比一般 Unity AI 工具更顺？**

1. **双进程解耦设计**
   - MCP Server（Python）与 Unity Editor（C#）完全解耦
   - 通过标准协议（MCP）通信，不依赖 Unity 内部 API 限制
   - Server 可独立部署、升级，不影响 Unity 项目

2. **标准化协议（MCP）**
   - 基于 Model Context Protocol，与 AI 生态无缝集成
   - 支持多种 MCP Client（Cursor、Claude Code、VS Code 等）
   - 工具和资源通过装饰器自动注册，易于扩展

3. **性能优化机制**
   - `batch_execute` 实现批量操作，减少网络往返（10-100x 提升）
   - Unity 侧主线程调度器确保 API 调用安全
   - 连接池管理多 Unity 实例

4. **插件化架构**
   - 工具通过装饰器自动发现和注册
   - 支持项目级自定义工具（Custom Tools）
   - 资源层提供只读查询，工具层提供写操作

5. **传输层灵活性**
   - 支持 HTTP（WebSocket）和 stdio 两种传输
   - HTTP 模式支持远程部署、API Key 认证
   - 自动重连、心跳保活机制

6. **开发体验优化**
   - Unity Editor 窗口提供一键配置
   - 自动检测和配置 MCP Client
   - 详细的错误提示和日志系统

7. **厚工具设计**
   - 单个工具处理完整工作流（如 `manage_gameobject` 处理创建、删除、修改、查询等）
   - 减少工具数量（33个工具 vs 可能的 100+ 个细粒度工具）
   - 降低 LLM 认知负担

8. **智能容错机制**
   - Domain reload 期间自动等待重连（最多 20s）
   - 快速失败机制（关键命令 2s 超时）
   - 编译等待机制（自动等待编译完成）

### 6.2 关键技术点

- **FastMCP 框架**：基于 FastAPI 的 MCP 服务器实现
- **WebSocket Plugin Hub**：Unity 实例注册和命令路由中心
- **主线程调度器**：确保 Unity API 调用在主线程执行
- **工具/资源注册表**：装饰器驱动的自动发现机制
- **批处理优化**：单次往返执行多个命令

### 6.3 潜在扩展点

- 自定义工具注册（已支持）
- 远程服务器部署（已支持 API Key 认证）
- 多 Unity 实例管理（已支持）
- 测试框架集成（已支持 Unity Test Framework）

---

**文档版本：** v1.0  
**分析日期：** 2026-03-06  
**分析范围：** 仓库总览 + 模块地图（非全量深挖）
