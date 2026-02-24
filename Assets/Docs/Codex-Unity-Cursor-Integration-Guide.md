# Codex Unity Cursor 接入完整指南

- 文档版本: v1.0
- 更新时间: 2026-02-24
- 适用范围: Cursor IDE + Codex Unity Sidecar
- 前置条件: Step 5-6 已完成（MCP Adapter + 推送通道）

## 1. 概述

当前 Sidecar 已实现 MCP Adapter 的 HTTP REST API 端点，但 Cursor 需要标准的 MCP (Model Context Protocol) 服务器。本指南提供两种接入方案：

- **方案 A（推荐）**: 创建 MCP 服务器包装器，将现有 HTTP API 桥接到 MCP 协议
- **方案 B**: 直接使用 HTTP 客户端工具（需要 Cursor 支持自定义工具）

## 2. 当前 Sidecar MCP 端点状态

### 2.1 已实现的端点

1. **POST /mcp/submit_unity_task**
   - 提交 Unity 任务
   - 支持幂等键、并发控制、审批模式

2. **GET /mcp/get_unity_task_status**
   - 查询任务状态（兜底查询）

3. **POST /mcp/cancel_unity_task**
   - 取消任务

4. **GET /mcp/stream**
   - SSE 推送通道（事件流）
   - 支持 `cursor` 重连补偿、`thread_id` 过滤

5. **GET /mcp/metrics**
   - 运行指标查询

### 2.2 启用 MCP Adapter

在启动 Sidecar 时设置环境变量：

**Windows PowerShell:**
```powershell
$env:ENABLE_MCP_ADAPTER="true"
$env:MCP_MAX_QUEUE="1"
$env:MCP_STREAM_MAX_EVENTS="500"
$env:MCP_STREAM_MAX_SUBSCRIBERS="32"
$env:MCP_STREAM_RECOVERY_JOBS_MAX="20"
```

**macOS/Linux Bash:**
```bash
export ENABLE_MCP_ADAPTER=true
export MCP_MAX_QUEUE=1
export MCP_STREAM_MAX_EVENTS=500
export MCP_STREAM_MAX_SUBSCRIBERS=32
export MCP_STREAM_RECOVERY_JOBS_MAX=20
```

或使用 npm 脚本（测试环境）：

```bash
cd sidecar
npm run smoke:mcp-job  # 会自动启用 MCP Adapter
```

## 3. 方案 A：MCP 服务器包装器（推荐）

### 3.1 架构设计

```
Cursor IDE
  ↓ (MCP stdio/SSE)
MCP Server Wrapper (新建)
  ↓ (HTTP REST)
Sidecar (现有)
  ↓
Unity Editor
```

### 3.2 完整接入步骤（按顺序执行）

#### Step 1: 配置 Cursor MCP（一次性设置）

**方式 1（推荐）: 使用自动配置脚本**

打开**新的终端窗口**（不要关闭，后续步骤需要），执行：

**推荐: 使用 Cursor 原生 MCP（无需插件）**

**Windows PowerShell:**
```powershell
cd sidecar
npm run mcp:setup-cursor -- --native
```

**macOS/Linux Bash:**
```bash
cd sidecar
npm run mcp:setup-cursor -- --native
```

**备选: 使用 Cline 插件配置（如果已安装 Cline）**

**Windows PowerShell:**
```powershell
cd sidecar
npm run mcp:setup-cursor
```

**macOS/Linux Bash:**
```bash
cd sidecar
npm run mcp:setup-cursor
```

脚本会自动：
- 检测 Cursor 配置文件路径
- 生成/更新 MCP 配置
- 保留现有的其他 MCP 服务器配置

如果需要指定 Sidecar URL（默认 `http://127.0.0.1:46321`）：

```powershell
npm run mcp:setup-cursor -- --native http://127.0.0.1:46321
```

**方式 2: 手动配置**

如果自动配置失败，可以手动编辑配置文件：

**重要说明**: 有两种配置方式：

**方式 A: Cursor 原生 MCP（推荐，无需插件）**
- Windows: `%APPDATA%\Cursor\mcp.json`
- macOS/Linux: `~/.cursor/mcp.json`
- 使用命令: `npm run mcp:setup-cursor -- --native`

**方式 B: Cline 插件配置（如果已安装 Cline 插件）**
- Windows: `%APPDATA%\Cursor\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
- macOS/Linux: `~/.config/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- 使用命令: `npm run mcp:setup-cursor`（默认）

**推荐使用方式 A（原生 MCP），无需安装任何插件。**

编辑配置文件，添加或更新 `mcpServers` 部分：

```json
{
  "mcpServers": {
    "unity-sidecar": {
      "command": "node",
      "args": [
        "D:/csgo/csgoToolV02/UnityAI/sidecar/src/mcp/mcpServer.js"
      ],
      "env": {
        "SIDECAR_BASE_URL": "http://127.0.0.1:46321"
      }
    }
  }
}
```

**重要提示**:
- 使用**绝对路径**指向 `mcpServer.js`（Windows 使用 `/` 或 `\` 都可以）
- 确保 Node.js 在系统 PATH 中，或使用完整路径（如 `C:\Program Files\nodejs\node.exe`）
- 如果 Sidecar 运行在不同端口，修改 `SIDECAR_BASE_URL` 环境变量

#### Step 2: 启动 Sidecar（启用 MCP Adapter）

在**新的终端窗口**中执行（保持运行，不要关闭）：

**方式 1（推荐）: 使用一键启动脚本**

**Windows PowerShell:**
```powershell
cd sidecar
.\start-sidecar.ps1
```

**macOS/Linux Bash:**
```bash
cd sidecar
chmod +x start-sidecar.sh
./start-sidecar.sh
```

**方式 2: 使用 npm 命令（跨平台）**

```bash
cd sidecar
npm run start:mcp
```

**方式 3: 手动设置环境变量（不推荐）**

**Windows PowerShell:**
```powershell
cd sidecar
$env:ENABLE_MCP_ADAPTER="true"
npm start
```

**macOS/Linux Bash:**
```bash
cd sidecar
export ENABLE_MCP_ADAPTER=true
npm start
```

**说明**:
- Sidecar 会持续运行，监听端口 `46321`（默认）
- 看到类似 `Server listening on port 46321` 的日志表示启动成功
- **保持此终端窗口打开**，关闭会导致 Sidecar 停止

#### Step 3: 重启 Cursor IDE

1. **完全关闭** Cursor IDE（不是最小化）
2. 重新打开 Cursor IDE
3. Cursor 会自动加载 MCP 配置并连接到 Sidecar

#### Step 4: 验证接入

**方法 0: 运行验证脚本（推荐，自动检查所有配置）**

```bash
cd sidecar
npm run mcp:verify
```

脚本会自动检查：
- Node.js 版本
- MCP 服务器文件是否存在
- Cursor 配置文件是否正确
- Sidecar 是否正在运行

**方法 1: 检查 Cursor 工具列表（最直接）**

1. 在 Cursor 中打开聊天面板
2. 输入 `@` 或查看可用工具列表
3. 如果看到以下工具，说明 MCP 接入成功：
   - `submit_unity_task`
   - `get_unity_task_status`
   - `cancel_unity_task`

**如果没有看到工具列表，请查看"故障排查"章节（第 6 节）**

**方法 2: 测试工具调用**

在 Cursor 聊天中输入：
```
请使用 Unity 工具在 Assets/Scripts/AIGenerated/ 目录下创建一个名为 TestMCP.cs 的测试脚本，内容是一个空的 MonoBehaviour 类
```

**关键验证点**：
- 如果 Cursor 能识别并调用 `submit_unity_task` 工具
- 如果 Sidecar 收到请求并返回 `job_id`
- 如果 Unity Editor 中实际创建了文件

**方法 3: 检查 Sidecar 日志**

在运行 Sidecar 的终端中，应该能看到：
- MCP 相关的请求日志
- `POST /mcp/submit_unity_task` 的请求记录

**注意**: 仅测试"创建脚本"无法证明 MCP 接入，因为 Cursor 本身也有这个能力。必须看到 Cursor **实际调用了 MCP 工具**才算成功。

---

### 3.3 测试 MCP 服务器（仅用于调试，非必需）

**注意**: 以下步骤仅用于测试 MCP 服务器是否正常工作，**不是接入 Cursor 的必需步骤**。

如果你想测试 MCP 服务器：

1. 打开新的终端窗口
2. 执行测试命令（会启动一个持续运行的进程）：

**Windows PowerShell:**
```powershell
cd sidecar
npm run mcp:server
```

**macOS/Linux Bash:**
```bash
cd sidecar
npm run mcp:server
```

3. 测试完成后，按 `Ctrl+C` 停止服务器

**重要**: 
- `npm run mcp:server` 只是用于测试的独立进程
- **实际使用时，Cursor 会自动启动 MCP 服务器**，你不需要手动运行这个命令
- 如果同时运行了测试服务器和 Cursor，可能会产生端口冲突

### 3.4 SSE 推送事件处理（可选增强）

如果需要实时推送事件，可以创建 SSE 客户端包装器：

```javascript
// sidecar/src/mcp/mcpStreamClient.js
class McpStreamClient {
  constructor(sidecarBaseUrl, threadId, onEvent) {
    this.sidecarBaseUrl = sidecarBaseUrl;
    this.threadId = threadId;
    this.onEvent = onEvent;
    this.eventSource = null;
  }

  connect(cursor = null) {
    const url = new URL(`${this.sidecarBaseUrl}/mcp/stream`);
    url.searchParams.set('thread_id', this.threadId);
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    this.eventSource = new EventSource(url.toString());
    this.eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.onEvent(payload);
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    this.eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      // 实现重连逻辑
    };
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
```

## 4. 方案 B：直接 HTTP 工具（备选）

如果 Cursor 支持自定义 HTTP 工具，可以直接配置：

```json
{
  "tools": [
    {
      "name": "submit_unity_task",
      "type": "http",
      "method": "POST",
      "url": "http://127.0.0.1:46321/mcp/submit_unity_task",
      "headers": {
        "Content-Type": "application/json"
      }
    }
  ]
}
```

**注意**: 此方案需要 Cursor 支持自定义 HTTP 工具，当前可能不支持。

## 5. 验证接入（可选调试步骤）

### 5.1 检查 Sidecar 健康状态

在终端中执行（确保 Sidecar 正在运行）：

**Windows PowerShell:**
```powershell
curl http://127.0.0.1:46321/health
```

**macOS/Linux Bash:**
```bash
curl http://127.0.0.1:46321/health
```

应该返回 `{"status":"ok"}` 或类似响应。

### 5.2 测试 MCP HTTP 端点（可选）

如果你想直接测试 HTTP 端点（不通过 Cursor）：

**Windows PowerShell:**
```powershell
$body = @{
    thread_id = "t_test_001"
    idempotency_key = "test_key_001"
    approval_mode = "auto"
    user_intent = "创建一个测试脚本"
    task_allocation = @{
        reasoning_and_plan = "创建 HelloWorld.cs 脚本"
        file_actions = @(
            @{
                type = "create_file"
                path = "Assets/Scripts/AIGenerated/HelloWorld.cs"
                content = "using UnityEngine;`npublic class HelloWorld : MonoBehaviour { }"
            }
        )
    }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/submit_unity_task" -Method POST -Body $body -ContentType "application/json"
```

**macOS/Linux Bash:**
```bash
curl -X POST http://127.0.0.1:46321/mcp/submit_unity_task \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id": "t_test_001",
    "idempotency_key": "test_key_001",
    "approval_mode": "auto",
    "user_intent": "创建一个测试脚本",
    "task_allocation": {
      "reasoning_and_plan": "创建 HelloWorld.cs 脚本",
      "file_actions": [
        {
          "type": "create_file",
          "path": "Assets/Scripts/AIGenerated/HelloWorld.cs",
          "content": "using UnityEngine;\\npublic class HelloWorld : MonoBehaviour { }"
        }
      ]
    }
  }'
```

### 5.3 在 Cursor 中测试（推荐方式）

1. 确保 Sidecar 正在运行（Step 2）
2. 确保已重启 Cursor IDE（Step 3）
3. 在 Cursor 聊天中输入: "使用 Unity 工具创建一个测试脚本"
4. Cursor 应该能够调用 `submit_unity_task` 工具
5. 检查 Unity Editor 中是否出现新文件

## 6. 故障排查

### 6.1 Cursor 中看不到工具列表（最常见问题）

**检查步骤：**

1. **确认配置文件存在且格式正确**
   - Windows: `%APPDATA%\Cursor\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
   - 打开文件，确认包含 `unity-sidecar` 配置
   - 确认路径是**绝对路径**（不是相对路径）

2. **确认配置方式**
   - 如果使用原生 MCP（推荐）：配置文件在 `~/.cursor/mcp.json` 或 `%APPDATA%\Cursor\mcp.json`
   - 如果使用 Cline 插件：需要确认 Cline 插件已安装并启用
   - **建议**: 重新运行 `npm run mcp:setup-cursor -- --native` 使用原生 MCP，无需插件

3. **检查 Sidecar 是否运行**
   ```powershell
   curl http://127.0.0.1:46321/health
   ```
   应该返回 `{"status":"ok"}`

4. **检查 MCP 服务器路径**
   - 确认 `sidecar/src/mcp/mcpServer.js` 文件存在
   - 确认 Node.js 在系统 PATH 中（运行 `node --version` 测试）

5. **完全重启 Cursor**
   - 完全关闭 Cursor（不是最小化）
   - 重新打开 Cursor
   - 等待几秒让 MCP 服务器初始化

6. **查看 Cursor 开发者工具日志**
   - 按 `Ctrl+Shift+I` 打开开发者工具
   - 查看 Console 标签页
   - 查找 MCP 相关的错误信息

7. **手动测试 MCP 服务器**
   ```powershell
   cd sidecar
   npm run mcp:server
   ```
   如果出现错误，说明 MCP 服务器本身有问题

### 6.2 MCP 服务器无法启动

- 检查 Node.js 版本（需要 >= 16）：`node --version`
- 检查 `SIDECAR_BASE_URL` 环境变量是否正确
- 检查 MCP 服务器文件是否存在：`sidecar/src/mcp/mcpServer.js`
- 检查文件权限（macOS/Linux）：`chmod +x sidecar/src/mcp/mcpServer.js`

### 6.3 Sidecar 返回 404

- 确认 `ENABLE_MCP_ADAPTER=true` 已设置
- 检查 Sidecar 日志确认 MCP Adapter 已启用
- 验证端口号是否正确（默认 46321）
- 检查 Sidecar 是否正在运行

### 6.4 Cursor 无法识别工具

- 检查 MCP 配置文件路径是否正确
- 确认配置文件路径正确（原生 MCP 或 Cline 插件）
- **建议**: 使用原生 MCP 配置（`--native` 参数），无需安装插件
- 完全重启 Cursor IDE（不是重新加载窗口）
- 查看 Cursor 开发者工具中的 MCP 日志
- 确认配置文件 JSON 格式正确（无语法错误）

### 6.4 任务提交失败

- 检查 `task_allocation` 结构是否符合验证器要求
- 查看 Sidecar 日志中的错误信息
- 确认文件路径在允许的白名单内（`Assets/Scripts/AIGenerated/`）

## 7. 高级配置

### 7.1 并发控制

```bash
export MCP_MAX_QUEUE=1  # 队列上限
```

### 7.2 推送事件缓冲

```bash
export MCP_STREAM_MAX_EVENTS=500  # 事件缓冲上限
export MCP_STREAM_MAX_SUBSCRIBERS=32  # 订阅者上限
```

### 7.3 审批模式

- `auto`: 自动执行，无需确认（MCP 默认）
- `require_user`: 需要用户确认（可能导致死锁，谨慎使用）

## 8. 下一步优化

1. **实现 SSE 推送集成**: 在 MCP 服务器中集成 SSE 客户端，实时推送任务进度
2. **错误自动修复**: 基于结构化错误反馈实现自动重试机制
3. **工具描述增强**: 添加更详细的工具描述和示例，提升 LLM 理解
4. **批量操作支持**: 支持批量提交多个任务

## 9. 参考文档

- [MCP Protocol Specification](https://modelcontextprotocol.io)
- `Assets/Docs/Codex-Unity-Panel-Status-Report.md` - 当前实现状态
- `Assets/Docs/Codex-Unity-Refactor-Roadmap.md` - 架构设计
- `sidecar/README.md` - Sidecar 使用说明

## 10. 支持与反馈

如遇到问题，请检查：
1. Sidecar 日志: `sidecar/.state/sidecar-state.json`
2. MCP 服务器日志: 标准错误输出
3. Cursor MCP 日志: Cursor 开发者工具
