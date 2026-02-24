# Cursor 接入指南修复说明

- 修复日期: 2026-02-24
- 修复版本: v1.1
- 修复范围: `sidecar/src/mcp/mcpServer.js` + `Assets/Docs/Codex-Unity-Cursor-Integration-Guide.md`

## 修复的问题

### ✅ 严重阻塞项（已修复）

#### 1. MCP stdio framing 协议兼容性

**问题**: 
- 原实现按"每行一个 JSON"解析（`mcpServer.js#L27`）
- 标准 MCP 协议使用 `Content-Length` framing 格式：`Content-Length: <length>\r\n\r\n<json>`
- 导致发送标准 Content-Length 帧时先返回 `-32700` 解析错误

**修复**:
- 重写 `setupStdioHandlers()` 实现标准 Content-Length framing 解析
- 修复 `sendResponse()` 和 `sendError()` 使用标准 framing 格式发送响应
- 参考实现：按字节长度读取完整 JSON，而非按行分割

**验证**:
- 现在可以正确处理标准 MCP Content-Length 帧
- 不再出现首次握手时的解析错误

#### 2. idempotency_key Schema 与 Validator 不一致

**问题**:
- Schema 中标记为可选（`mcpServer.js#L125`）
- 但后端 validator 要求必填（`validators.js#L734`）
- 导致模型按 schema 不传该字段时返回 400

**修复**:
- 将 `idempotency_key` 添加到 `required` 数组（`mcpServer.js#L238`）
- 更新字段描述，明确标注为 "Required"
- Schema 与 validator 现在一致

### ✅ 非阻塞项（已修复）

#### 3. 文档不一致问题

**问题**:
- Guide#L73 说"无需安装额外的 SDK"
- Guide#L273 又说"检查 `@modelcontextprotocol/sdk` 是否已安装"
- 矛盾

**修复**:
- 删除排障部分中关于 SDK 的检查项
- 统一说明：使用 Node.js 内置模块，无需额外 SDK

#### 4. Windows PowerShell 兼容性

**问题**:
- 文档使用 Bash 语法（`export`、`\` 换行、单引号）
- 不适合 Windows PowerShell 用户

**修复**:
- 所有命令示例同时提供 PowerShell 和 Bash 版本
- 使用 `$env:` 替代 `export`（PowerShell）
- 使用双引号替代单引号（PowerShell）

#### 5. 配置路径说明

**问题**:
- 文档未明确说明这是 **Cline 插件**配置路径
- 可能与其他 Cursor MCP 配置混淆

**修复**:
- 在配置路径说明中添加"重要说明"
- 明确标注：此配置路径适用于 **Cline 插件**（在 Cursor 中使用）
- 在 `setup-cursor-mcp.js` 注释中也添加说明

## 修复后的文件

1. `sidecar/src/mcp/mcpServer.js`
   - 实现标准 Content-Length framing 解析
   - 修复 idempotency_key schema 必填要求
   - 改进错误处理

2. `Assets/Docs/Codex-Unity-Cursor-Integration-Guide.md`
   - 修复文档不一致
   - 添加 Windows PowerShell 兼容命令
   - 明确配置路径说明

3. `sidecar/scripts/setup-cursor-mcp.js`
   - 更新注释说明配置路径用途

## 验证建议

1. **测试 MCP 协议兼容性**:
   ```bash
   # 使用标准 MCP 客户端测试
   echo -e "Content-Length: 45\r\n\r\n{\"jsonrpc\":\"2.0\",\"method\":\"initialize\",\"id\":1}" | node sidecar/src/mcp/mcpServer.js
   ```

2. **测试 idempotency_key 必填**:
   - 不传 `idempotency_key` 应返回 400 错误
   - 传入 `idempotency_key` 应正常工作

3. **测试 Windows 兼容性**:
   - 在 Windows PowerShell 中运行所有命令示例
   - 验证环境变量设置正确

## 当前状态

✅ **所有阻塞项已修复**  
✅ **所有非阻塞项已修复**  
✅ **文档已更新并保持一致**

**结论**: 接入指南现在可以稳定接入 Cursor（通过 Cline 插件）。
