# Phase 9 手动验收流程指南

## 概述

本文档提供 Phase 9 MCP Command Decoupling 的手动验收测试流程，重点测试 `capture_scene_screenshot` 的三种捕获模式。

## 前置条件

1. Sidecar 服务正在运行（`http://127.0.0.1:46321`）
2. Unity Editor 已连接并可以响应查询
3. 自动化测试已全部通过

## 截图模式说明

`capture_scene_screenshot` 支持三种 `capture_mode`：

1. **`render_output`** (默认)
   - Camera 渲染输出
   - 捕获 Camera 的渲染结果
   - 适用于世界空间 UI

2. **`final_pixels`**
   - 最终像素输出（GameView）
   - 最佳效果捕获最终 GameView 像素
   - 目标：捕获 Overlay UI
   - 如果不可用，会降级到 `render_output` 并返回 `fallback_reason`

3. **`editor_view`**
   - SceneView 调试视图
   - 捕获 Scene 视图的调试视图

## 手动验收测试流程

### 测试 1: Case A - 新命令使用单一注册表路径

#### 1.1 测试 render_output 模式（默认）

```powershell
$body = @{
    view_mode = "scene"
    capture_mode = "render_output"
    output_mode = "artifact_uri"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
$response | ConvertTo-Json -Depth 5
```

**验证点：**
- [ ] `ok: true`
- [ ] `data.artifact_uri` 存在
- [ ] `data.capture_mode_effective` 为 `"render_output"`
- [ ] `read_token.token` 存在
- [ ] 打开截图文件，验证内容正确

#### 1.2 测试 final_pixels 模式

```powershell
$body = @{
    view_mode = "game"
    capture_mode = "final_pixels"
    output_mode = "artifact_uri"
    include_ui = $true
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
$response | ConvertTo-Json -Depth 5
```

**验证点：**
- [ ] `ok: true`
- [ ] `data.artifact_uri` 存在
- [ ] `data.capture_mode_effective` 为 `"final_pixels"` 或 `"render_output"`（如果降级）
- [ ] 如果降级，`data.fallback_reason` 存在且可操作
- [ ] `read_token.token` 存在
- [ ] 打开截图文件，验证内容正确（如果支持 final_pixels，应包含 Overlay UI）

#### 1.3 测试 editor_view 模式

```powershell
$body = @{
    view_mode = "scene"
    capture_mode = "editor_view"
    output_mode = "artifact_uri"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
$response | ConvertTo-Json -Depth 5
```

**验证点：**
- [ ] `ok: true`
- [ ] `data.artifact_uri` 存在
- [ ] `data.capture_mode_effective` 为 `"editor_view"`
- [ ] `read_token.token` 存在
- [ ] 打开截图文件，验证内容正确（Scene 视图调试视图）

#### 1.4 测试 inline_base64 模式

```powershell
$body = @{
    view_mode = "game"
    capture_mode = "render_output"
    output_mode = "inline_base64"
    image_format = "png"
    width = 640
    height = 480
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
$response | ConvertTo-Json -Depth 5
```

**验证点：**
- [ ] `ok: true`
- [ ] `data.image_base64` 存在且非空
- [ ] `data.mime_type` 为 `"image/png"`
- [ ] `data.width` 和 `data.height` 符合请求
- [ ] 可以解码 Base64 并查看图片

---

### 测试 2: Case B - 截图错误分类是 LLM 友好的

#### 2.1 创建缺失视图场景

在 Unity Editor 中：
1. 关闭所有 Scene 视图和 Game 视图窗口
2. 或者禁用所有 Camera 组件

#### 2.2 调用截图命令

```powershell
$body = @{
    view_mode = "game"
    capture_mode = "render_output"
    output_mode = "artifact_uri"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $errorBody = $reader.ReadToEnd() | ConvertFrom-Json
    $errorBody | ConvertTo-Json -Depth 5
}
```

**验证点：**
- [ ] 返回 `E_SCREENSHOT_VIEW_NOT_FOUND` 错误
- [ ] `recoverable: true`
- [ ] `suggestion` 字段存在
- [ ] `suggestion` 内容清晰可操作（人工判断是否 LLM 友好）

---

### 测试 3: Case C - 工件清理（无无限增长）

#### 3.1 生成截图文件

```powershell
$body = @{
    view_mode = "scene"
    capture_mode = "render_output"
    output_mode = "artifact_uri"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
Write-Host "Artifact URI: $($response.data.artifact_uri)"
```

#### 3.2 创建过期文件

```powershell
$artifactDir = "D:\csgo\csgoToolV02\UnityAI\Library\Codex\McpArtifacts"
$staleFile = Join-Path $artifactDir "scene_capture_stale_test_$(Get-Date -Format 'yyyyMMddHHmmss').png"
[byte[]] $bytes = 1,2,3,4,5
[System.IO.File]::WriteAllBytes($staleFile, $bytes)
$oldTime = (Get-Date).AddHours(-48)
(Get-Item $staleFile).LastWriteTime = $oldTime
Write-Host "已创建过期文件: $staleFile"
```

#### 3.3 再次触发截图

```powershell
$body = @{
    view_mode = "scene"
    capture_mode = "render_output"
    output_mode = "artifact_uri"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body
Start-Sleep -Seconds 2
```

#### 3.4 验证清理

```powershell
$staleFileCheck = Get-ChildItem "D:\csgo\csgoToolV02\UnityAI\Library\Codex\McpArtifacts" -Filter "scene_capture_stale_test_*.png" | Select-Object -First 1
if ($staleFileCheck) {
    Write-Host "✗ 过期文件未被清理: $($staleFileCheck.FullName)"
} else {
    Write-Host "✓ 过期文件已被清理"
}

$fileCount = (Get-ChildItem "D:\csgo\csgoToolV02\UnityAI\Library\Codex\McpArtifacts" -File).Count
Write-Host "当前工件文件数: $fileCount"
```

**验证点：**
- [ ] 过期文件已被删除
- [ ] 总文件数保持在合理范围内

---

### 测试 4: Case D - Visual Chain Regression (Tree-First Then Screenshot)

#### 4.1 调用 get_ui_tree

```powershell
$body1 = @{
    ui_system = "ugui"
    include_layout = $true
    include_components = $true
} | ConvertTo-Json

$response1 = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/get_ui_tree" -Method Post -ContentType "application/json" -Body $body1
Write-Host "get_ui_tree read_token: $($response1.read_token.token)"
if ($response1.data.nodes) {
    Write-Host "节点数量: $($response1.data.nodes.Count)"
    if ($response1.data.nodes.Count -gt 0) {
        Write-Host "示例节点路径: $($response1.data.nodes[0].path)"
    }
}
```

#### 4.2 调用 capture_scene_screenshot（tree-first flow）

```powershell
$body2 = @{
    view_mode = "game"
    capture_mode = "final_pixels"
    include_ui = $true
    output_mode = "artifact_uri"
} | ConvertTo-Json

$response2 = Invoke-RestMethod -Uri "http://127.0.0.1:46321/mcp/capture_scene_screenshot" -Method Post -ContentType "application/json" -Body $body2
$response2 | ConvertTo-Json -Depth 5
```

**验证点：**
- [ ] 查询顺序正确：`get_ui_tree` -> `capture_scene_screenshot`（无反向回退流程）
- [ ] `capture_scene_screenshot` 响应包含 `capture_mode_effective`
- [ ] 如果降级，`fallback_reason` 存在且可操作
- [ ] 两个响应都包含有效的 `read_token`

---

### 测试 5: Case E - 已弃用的工具端点

```powershell
$endpoints = @(
    "/mcp/get_current_selection",
    "/mcp/get_gameobject_components",
    "/mcp/get_hierarchy_subtree",
    "/mcp/get_prefab_info",
    "/mcp/get_compile_state",
    "/mcp/get_console_errors"
)

foreach ($ep in $endpoints) {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:46321$ep" -Method Post -ContentType "application/json" -Body "{}" -ErrorAction Stop
        Write-Host "✗ $ep : 仍然可用（不应该）"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq 410) {
            Write-Host "✓ $ep : 已正确移除 (410 E_GONE)"
        } else {
            Write-Host "? $ep : 返回状态码 $code"
        }
    }
}
```

**验证点：**
- [ ] 所有已弃用端点返回 `410 E_GONE`

---

### 测试 6: Unity EditMode 测试

在 Unity Editor 中运行以下测试类：

1. **UnityRagReadServiceScreenshotTests**
   - 测试截图功能的基本功能

2. **UnityRagReadServiceUiTreeTests**
   - 测试 UI 树查询功能

3. **UnityVisualReadChainTests**
   - 测试视觉链回归（tree-first flow）

4. **SidecarContractsExtensibilityDtoTests**
   - 测试 DTO 序列化

5. **SidecarContractsSnapshotTests**
   - 测试快照功能

**验证点：**
- [ ] 所有测试通过
- [ ] 现有 R10/R9 基线套件仍然通过

---

## 验收检查清单

完成所有测试后，在 `Phase9-MCP-Command-Decoupling-Acceptance.md` 的 Section 7 中打勾：

- [ ] **R11 sidecar test/gate set green** - ✅ 已完成（自动化测试已通过）
- [ ] **Unity EditMode suite green** - 需要运行 Unity EditMode 测试
- [ ] **Screenshot success/failure/cleanup scenarios verified** - 需要完成测试 1、2、3
- [ ] **R11-QA-03 tree-first visual chain scenario verified** - 需要完成测试 4
- [ ] **Deprecated command paths confirmed closed** - 需要完成测试 5
- [ ] **Main index updated with R11 authoritative links** - ✅ 已完成（代码检查已确认）

---

## 截图文件位置

所有截图文件保存在：
```
D:\csgo\csgoToolV02\UnityAI\Library\Codex\McpArtifacts\
```

文件命名格式：`scene_capture_YYYYMMDD_HHMMSS_mmm.png`

可以使用以下命令打开文件夹：
```powershell
explorer "D:\csgo\csgoToolV02\UnityAI\Library\Codex\McpArtifacts"
```

---

## 故障排除

### 截图没有正确的元素
- 检查 Unity Editor 中 Scene/Game 视图的视角
- 调整 Camera 的位置和旋转
- 确认场景中有可见的对象

### final_pixels 模式降级
- 这是正常行为，如果 Unity 不支持 final_pixels，会自动降级到 render_output
- 检查 `fallback_reason` 了解降级原因

### 错误消息不够清晰
- 检查 `suggestion` 字段的内容
- 如果不够清晰，需要改进错误消息的生成逻辑
