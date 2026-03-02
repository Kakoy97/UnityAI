# Phase 9 手动验收测试流程指南

## 前置条件

### 1. 启动 Sidecar 服务
```powershell
cd D:\csgo\csgoToolV02\UnityAI\sidecar
npm start
```
保持这个终端窗口运行，sidecar 会在 `http://127.0.0.1:46321` 上运行。

### 2. 启动 Unity Editor
- 打开 Unity 项目
- 确保 Unity Editor 已连接到 sidecar（通常会自动连接）
- 验证连接：在 Unity Editor 中应该能看到 sidecar 连接状态

---

## 测试流程

### 测试 1: Case A - 新命令使用单一注册表路径

#### 步骤 1.1: 确认 Sidecar 运行状态
打开新的 PowerShell 窗口，首先检查 sidecar 是否在运行：
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:46321/health" -Method Get
```

**预期结果：**
- 返回 `{"ok": true}` 表示 sidecar 正在运行

**注意：** `tools/list` 是 MCP 协议方法（通过 stdio/WebSocket），不是直接的 HTTP 路由。我们将在下一步直接测试 `capture_scene_screenshot` HTTP 端点来验证工具存在并正常工作。

#### 步骤 1.2: 测试 Scene 视图截图（artifact_uri 模式）
```powershell
$body = @{
    view_mode = "scene"
    output_mode = "artifact_uri"
    timeout_ms = 5000
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
$response | ConvertTo-Json -Depth 10
```

**预期结果：**
- `ok: true`
- `data.artifact_uri` 存在（例如：`artifact://unity/snapshots/scene_xxx.png`）
- `read_token.token` 存在
- 状态码：200

**验证截图文件：**
- 根据返回的 `artifact_uri`，找到对应的文件路径（通常在 `Library/Codex/McpArtifacts/` 目录）
- 打开图片文件，验证截图内容正确

#### 步骤 1.3: 测试 Game 视图截图（inline_base64 模式）
```powershell
$body = @{
    view_mode = "game"
    output_mode = "inline_base64"
    image_format = "png"
    width = 640
    height = 480
    timeout_ms = 5000
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
$response | ConvertTo-Json -Depth 10
```

**预期结果：**
- `ok: true`
- `data.image_base64` 存在（Base64 编码的图片数据）
- `data.mime_type` 为 `"image/png"`
- `data.width` 和 `data.height` 符合请求
- `read_token.token` 存在
- 状态码：200

**验证 Base64 图片：**
- 复制 `data.image_base64` 的值
- 使用在线 Base64 解码工具或 PowerShell 脚本解码并保存为图片
- 打开图片验证内容正确

---

### 测试 2: Case B - 截图错误分类是 LLM 友好的

#### 步骤 2.1: 创建缺失视图场景
在 Unity Editor 中：
1. 关闭所有 Scene 视图和 Game 视图窗口
2. 或者禁用所有 Camera 组件

#### 步骤 2.2: 调用截图命令
```powershell
$body = @{
    view_mode = "game"
    output_mode = "artifact_uri"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
    $response | ConvertTo-Json -Depth 10
} catch {
    $_.Exception.Response | ConvertTo-Json -Depth 10
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $responseBody = $reader.ReadToEnd()
    $responseBody | ConvertFrom-Json | ConvertTo-Json -Depth 10
}
```

**预期结果：**
- `ok: false` 或状态码为 404
- `error_code: "E_SCREENSHOT_VIEW_NOT_FOUND"`
- `recoverable: true`
- `suggestion` 字段存在且包含可操作的建议
- `suggestion` 应该提到 "capture_scene_screenshot" 或如何修复问题

**人工判断：**
- [ ] `suggestion` 是否清晰易懂？
- [ ] `suggestion` 是否提供了具体的修复步骤？
- [ ] 错误消息是否对 LLM 友好（结构化、可解析）？

---

### 测试 3: Case C - 工件清理（无无限增长）

#### 步骤 3.1: 生成截图文件
```powershell
$body = @{
    view_mode = "scene"
    output_mode = "artifact_uri"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
$response | ConvertTo-Json -Depth 10
Write-Host "Artifact URI: $($response.data.artifact_uri)"
```

记录返回的 `artifact_uri`，确认文件已创建。

#### 步骤 3.2: 创建过期文件
在 PowerShell 中：
```powershell
$artifactDir = "D:\csgo\csgoToolV02\UnityAI\Library\Codex\McpArtifacts"
New-Item -ItemType Directory -Force -Path $artifactDir

# 创建一个过期文件（修改时间为 48 小时前）
$staleFile = Join-Path $artifactDir "stale_test_file.png"
[byte[]] $bytes = 1,2,3,4,5
[System.IO.File]::WriteAllBytes($staleFile, $bytes)
$oldTime = (Get-Date).AddHours(-48)
(Get-Item $staleFile).LastWriteTime = $oldTime

Write-Host "已创建过期文件: $staleFile"
Write-Host "文件修改时间: $((Get-Item $staleFile).LastWriteTime)"
```

#### 步骤 3.3: 再次触发截图
```powershell
$body = @{
    view_mode = "scene"
    output_mode = "artifact_uri"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
$response | ConvertTo-Json -Depth 10
```

#### 步骤 3.4: 验证清理
```powershell
$staleFile = "D:\csgo\csgoToolV02\UnityAI\Library\Codex\McpArtifacts\stale_test_file.png"
if (Test-Path $staleFile) {
    Write-Host "❌ 过期文件未被清理: $staleFile"
} else {
    Write-Host "✓ 过期文件已被清理"
}

# 检查总文件数
$artifactDir = "D:\csgo\csgoToolV02\UnityAI\Library\Codex\McpArtifacts"
$fileCount = (Get-ChildItem $artifactDir -File).Count
Write-Host "当前工件文件数: $fileCount"
```

**预期结果：**
- 过期文件 `stale_test_file.png` 已被删除
- 总文件数保持在合理范围内（通常不超过配置的上限）

---

### 测试 4: Case D - 已弃用的 MCP 工具已关闭

#### 步骤 4.1: 检查已弃用的工具端点
由于 `tools/list` 是 MCP 协议方法，我们通过测试已弃用的 HTTP 端点来验证它们已被移除：

```powershell
$deprecatedEndpoints = @(
    "/mcp/get_current_selection",
    "/mcp/get_gameobject_components",
    "/mcp/get_hierarchy_subtree",
    "/mcp/get_prefab_info",
    "/mcp/get_compile_state",
    "/mcp/get_console_errors"
)

Write-Host "测试已弃用的端点..."
foreach ($endpoint in $deprecatedEndpoints) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:46321$endpoint" -Method Post -ContentType "application/json" -Body "{}" -ErrorAction Stop
        Write-Host "❌ $endpoint : 仍然可用（不应该）"
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 410) {
            Write-Host "✓ $endpoint : 已正确移除 (410 E_GONE)"
        } else {
            Write-Host "? $endpoint : 返回状态码 $statusCode"
        }
    }
}
```

**预期结果：**
- 所有已弃用的端点返回 `410 E_GONE` 错误
- 这些端点不应该正常工作

**验证以下工具名称不在列表中：**
- `get_current_selection`
- `get_gameobject_components`
- `get_hierarchy_subtree`
- `get_prefab_info`
- `get_compile_state`
- `get_console_errors`

**预期结果：**
- 这些工具名称都不应该出现在 `tools/list` 响应中
- 只有新的工具名称应该存在（如 `list_assets_in_folder`, `get_scene_roots`, `find_objects_by_component`, `query_prefab_info`, `capture_scene_screenshot` 等）

---

### 测试 5: Unity EditMode 测试

#### 步骤 5.1: 在 Unity Editor 中运行测试
1. 打开 Unity Editor
2. 打开 Test Runner 窗口：`Window` → `General` → `Test Runner`
3. 切换到 `EditMode` 标签
4. 运行以下测试类：
   - `UnityRagReadServiceScreenshotTests`
   - `SidecarContractsExtensibilityDtoTests`
   - `SidecarContractsSnapshotTests`

**预期结果：**
- 所有测试通过（绿色 ✓）
- 没有失败的测试

#### 步骤 5.2: 运行 R10/R9 基线回归测试
在 Test Runner 中运行所有 EditMode 测试，确保没有回归。

**预期结果：**
- 所有现有测试仍然通过
- 没有新的失败

---

## 验收检查清单

完成所有测试后，在 `Phase9-MCP-Command-Decoupling-Acceptance.md` 的 Section 7 中打勾：

- [ ] **R11 sidecar test/gate set green** - ✅ 已完成（自动化测试已通过）
- [ ] **Unity EditMode suite green** - 需要运行 Unity EditMode 测试
- [ ] **Screenshot success/failure/cleanup scenarios verified** - 需要完成测试 1、2、3
- [ ] **Deprecated command paths confirmed closed** - 需要完成测试 4
- [ ] **Main index updated with R11 authoritative links** - ✅ 已完成（代码检查已确认）

---

## 故障排除

### Sidecar 无法启动
- 检查端口 46321 是否被占用
- 检查 `sidecar/node_modules` 是否已安装

### Unity Editor 未连接
- 检查 Unity Editor 控制台是否有连接错误
- 确认 sidecar 服务正在运行
- 检查 Unity Editor 的 Codex 插件配置

### 截图返回错误
- 确认 Unity Editor 中有活动的 Scene 或 Game 视图
- 确认有活动的 Camera 组件
- 检查 Unity Editor 控制台的错误消息

### 工件清理未工作
- 检查 `Library/Codex/McpArtifacts` 目录权限
- 确认文件修改时间确实超过阈值（通常 24-48 小时）
- 查看 sidecar 日志中的清理信息
