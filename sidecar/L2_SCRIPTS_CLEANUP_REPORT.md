# L2 测试脚本与 CI 门禁清扫报告

## 📋 执行摘要

基于 L2 架构重构前提（已完全移除 LLM、Planner、Prompt、Memory Capsule 逻辑，删除所有 `/turn/*` 接口），本报告对 `sidecar/scripts/` 目录和 `sidecar/package.json` 进行了深度静态分析，识别出所有废弃的测试脚本和指标统计代码。

---

## 🔍 1. 深度冗余扫描结果

### 1.1 废弃的回归测试脚本

#### ❌ **smoke-turn-runner.js** - **必须删除**
- **文件路径**: `sidecar/scripts/smoke-turn-runner.js`
- **行数**: 2527 行
- **废弃原因**:
  - 完全依赖已删除的 `/turn/send` 接口（第189、1156、1235、1338行）
  - 依赖已删除的 `/turn/status` 接口（第1774、1806行）
  - 依赖已删除的 `/turn/cancel` 接口（第224、1041行）
  - 包含大量 LLM 相关测试用例：
    - `turn_send_cancel_smoke` (第174-251行)
    - `codex_timeout_sweep` (第1127-1202行) - 测试 `E_CODEX_TIMEOUT`
    - `unity_query_timeout_non_blocking` (第1205-1302行) - 依赖 `turn.send`
    - `unity_query_probe_success_chain` (第1305-1564行) - 依赖 `turn.send`
  - 包含废弃的配置参数：
    - `--codex-soft-timeout-ms` (第1706行)
    - `--codex-hard-timeout-ms` (第1714行)
    - `--fake-codex-timeout-planner` (第1660行)
    - `--fake-unity-query-planner` (第1672行)
- **影响范围**: 
  - 被 `replay-failed-report.js` 引用（第180行），需要同步更新
  - 被 `package.json` 中 3 个 npm scripts 引用

---

### 1.2 需要净化的质量门禁脚本

#### ⚠️ **step8-quality-gate.js** - **需要精简化**
- **文件路径**: `sidecar/scripts/step8-quality-gate.js`
- **当前状态**: 690 行
- **需要删除的 LLM 相关断言**:

  **A. `buildObservabilitySummary` 函数中的 LLM 指标** (第397-482行):
  - ❌ `timeout_rate_pct` (第403、473行) - 统计 LLM 超时率
  - ❌ `E_CODEX_TIMEOUT` 错误码检测 (第419行) - LLM 超时错误码
  - ❌ `timeout_turns` 统计 (第424、472行) - 包含 LLM 超时统计
  - ✅ **保留**: `E_COMPILE_TIMEOUT` - Unity 编译超时（仍有效）
  - ✅ **保留**: `compile_round_duration_ms` - Unity 编译时长统计（第405、475行）
  - ✅ **保留**: `action_attempt_turns`、`action_success_turns`、`action_success_rate_pct` - Unity 动作执行统计（第406-408、476-478行）

  **B. 输出日志中的 LLM 指标** (第679行):
  - ❌ `timeout_rate_pct` - 应改为仅统计 `E_COMPILE_TIMEOUT` 的超时率
  - ✅ **保留**: `action_success_rate_pct` - Unity 动作成功率

  **C. 需要保留的核心功能**:
  - ✅ `buildMatrix` 函数 (第124-168行) - 调用 MCP 测试脚本，必须保留
  - ✅ `buildRegressionSummary` 函数 (第362-395行) - 回归测试汇总，必须保留
  - ✅ `requirements` 对象中的 MCP 相关检查 (第43-56行) - 必须保留

---

### 1.3 需要更新的回放脚本

#### ⚠️ **replay-failed-report.js** - **需要更新引用**
- **文件路径**: `sidecar/scripts/replay-failed-report.js`
- **当前状态**: 508 行
- **问题**: 
  - 第180行硬编码引用 `scripts/smoke-turn-runner.js`
  - 包含废弃的 LLM 相关配置参数（第197、224行）：
    - `include_codex_timeout_case`
    - `use_fake_codex_timeout_planner`
- **建议**: 
  - 更新为支持 MCP 测试报告回放（`mcp-job-runner.js`、`mcp-stream-runner.js`）
  - 删除所有 LLM 相关的配置参数处理逻辑

---

### 1.4 幽灵 NPM 指令

#### ❌ **package.json 中需要删除的 scripts**:

```json
// 以下 3 个 scripts 完全依赖已删除的 smoke-turn-runner.js
"smoke:codex-timeout": "node scripts/smoke-turn-runner.js --base-url http://127.0.0.1:46330 --iterations 1 --skip-turn-send --include-codex-timeout-case --spawn-sidecar --fake-codex-timeout-planner --codex-soft-timeout-ms 1200 --codex-hard-timeout-ms 2400",
"smoke:query-timeout": "node scripts/smoke-turn-runner.js --base-url http://127.0.0.1:46329 --iterations 1 --skip-turn-send --include-query-timeout-case --spawn-sidecar --unity-query-timeout-ms 1200",
"smoke:query-probe": "node scripts/smoke-turn-runner.js --base-url http://127.0.0.1:46328 --iterations 1 --skip-turn-send --include-query-probe-case --spawn-sidecar --fake-unity-query-mode remove_except_keep --fake-unity-query-keep-component KeepComponent --unity-query-timeout-ms 5000",
```

#### ✅ **需要保留的 scripts** (已验证有效):
- `smoke` - 调用 MCP 测试脚本，有效
- `smoke:fast` - 调用 MCP 测试脚本，有效
- `smoke:mcp-visual-anchor` - MCP 视觉锚点测试，有效
- `smoke:mcp-job` - MCP Job 测试，有效
- `smoke:mcp-stream` - MCP Stream 测试，有效
- `gate:step8` - 质量门禁，需要净化但保留
- `replay:failed` - 失败回放，需要更新但保留
- `metrics:step8` - 指标统计，需要净化但保留
- `mcp:server` - MCP 服务器，有效
- `mcp:setup-cursor` - MCP 配置助手，有效
- `mcp:verify` - MCP 验证，有效

---

## 🛡️ 2. 必须保护的生命线（已验证）

### ✅ **mcp-job-runner.js** - **核心 MCP Job 测试**
- **状态**: ✅ 完全有效
- **功能**: 验证 Job Ticket 并发、互斥、幂等性
- **依赖**: 仅使用 `/mcp/*` 接口，无 LLM 依赖

### ✅ **mcp-stream-runner.js** - **核心 MCP Stream 测试**
- **状态**: ✅ 完全有效
- **功能**: 验证 SSE 推送与断线重连
- **依赖**: 仅使用 `/mcp/*` 接口，无 LLM 依赖

### ✅ **mcp-visual-anchor-regression.js** - **MCP 视觉锚点测试**
- **状态**: ✅ 完全有效
- **功能**: 验证视觉锚点冲突检测
- **依赖**: 仅使用 MCP 服务，无 LLM 依赖

### ✅ **setup-cursor-mcp.js** - **MCP 配置助手**
- **状态**: ✅ 完全有效
- **功能**: 生成 Cursor MCP 配置文件

### ✅ **verify-mcp-setup.js** - **MCP 验证工具**
- **状态**: ✅ 完全有效
- **功能**: 验证 MCP 配置和连接

---

## 📝 3. 无情清扫清单（精确到文件）

### 3.1 物理删除的脚本文件

| 文件路径 | 删除原因 | 行数 |
|---------|---------|------|
| `sidecar/scripts/smoke-turn-runner.js` | 完全依赖已删除的 `/turn/*` 接口 | 2527 |

### 3.2 package.json 中需要删除的 npm scripts

| Script 名称 | 行号范围 | 删除原因 |
|------------|---------|---------|
| `smoke:codex-timeout` | 第12行 | 依赖 `smoke-turn-runner.js`，测试 LLM 超时 |
| `smoke:query-timeout` | 第13行 | 依赖 `smoke-turn-runner.js`，测试 Unity Query 超时 |
| `smoke:query-probe` | 第14行 | 依赖 `smoke-turn-runner.js`，测试 Unity Query 探测 |

### 3.3 step8-quality-gate.js 需要精简的内容

#### A. 删除 LLM 相关的超时统计逻辑

**位置**: `buildObservabilitySummary` 函数 (第397-482行)

**需要修改**:
1. **第419行**: 将 `timeoutCodes` 从 `new Set(["E_CODEX_TIMEOUT", "E_COMPILE_TIMEOUT"])` 改为 `new Set(["E_COMPILE_TIMEOUT"])`
2. **第403行**: 保留 `timeout_rate_pct` 但仅统计 `E_COMPILE_TIMEOUT`
3. **第473行**: `timeout_rate_pct` 计算逻辑保持不变（但仅统计编译超时）

**需要保留**:
- ✅ `compile_round_duration_ms` - Unity 编译时长统计
- ✅ `action_attempt_turns`、`action_success_turns`、`action_success_rate_pct` - Unity 动作执行统计
- ✅ `cancelled_turns` - 取消统计（可能用于 MCP Job 取消）

#### B. 更新输出日志

**位置**: `printSummary` 函数 (第665-683行)

**需要修改**:
- **第679行**: 将 `timeout_rate_pct` 的说明更新为"编译超时率"（仅统计 `E_COMPILE_TIMEOUT`）

### 3.4 replay-failed-report.js 需要更新的内容

#### A. 更新脚本引用

**位置**: `buildReplayCommand` 函数 (第180行)

**需要修改**:
- 将硬编码的 `scripts/smoke-turn-runner.js` 改为动态检测报告类型，支持：
  - `mcp-job-runner.js` (对于 `mcp_job` 类型报告)
  - `mcp-stream-runner.js` (对于 `mcp_stream` 类型报告)
  - `mcp-visual-anchor-regression.js` (对于 `mcp_visual_anchor` 类型报告)

#### B. 删除 LLM 相关配置参数处理

**位置**: `buildReplayCommand` 函数 (第195-238行)

**需要删除的参数处理**:
- ❌ `--include-codex-timeout-case` / `--skip-codex-timeout-case` (第197-200行)
- ❌ `--codex-soft-timeout-ms` (第217行)
- ❌ `--codex-hard-timeout-ms` (第218行)
- ❌ `--fake-codex-timeout-planner` (第224-226行)

**需要保留的参数处理**:
- ✅ `--include-timeout-case` / `--skip-timeout-case` (编译超时测试，仍有效)
- ✅ `--compile-timeout-ms` (Unity 编译超时，仍有效)
- ✅ `--include-query-timeout-case` / `--skip-query-timeout-case` (Unity Query 超时，仍有效)
- ✅ `--include-query-probe-case` / `--skip-query-probe-case` (Unity Query 探测，仍有效)

---

## 📊 4. 清扫影响评估

### 4.1 删除影响

| 删除项 | 影响范围 | 风险评估 |
|--------|---------|---------|
| `smoke-turn-runner.js` | `replay-failed-report.js` 需要更新 | 🟡 中等 - 需要同步更新回放脚本 |
| `smoke:codex-timeout` 等 3 个 scripts | 无其他依赖 | 🟢 低 - 可直接删除 |
| `step8-quality-gate.js` 中的 LLM 指标 | 仅影响指标统计，不影响核心功能 | 🟢 低 - 仅需精简化 |

### 4.2 保留的生命线验证

| 脚本 | 依赖检查 | 状态 |
|------|---------|------|
| `mcp-job-runner.js` | ✅ 仅使用 `/mcp/*` 接口 | 🟢 安全 |
| `mcp-stream-runner.js` | ✅ 仅使用 `/mcp/*` 接口 | 🟢 安全 |
| `mcp-visual-anchor-regression.js` | ✅ 仅使用 MCP 服务 | 🟢 安全 |
| `replay-failed-report.js` | ⚠️ 需要更新引用 | 🟡 需更新 |
| `step8-quality-gate.js` | ⚠️ 需要净化 LLM 指标 | 🟡 需净化 |

---

## ✅ 5. 执行建议

### 5.1 执行顺序

1. **第一步**: 删除 `smoke-turn-runner.js` 文件
2. **第二步**: 从 `package.json` 删除 3 个废弃的 npm scripts
3. **第三步**: 净化 `step8-quality-gate.js` 中的 LLM 指标
4. **第四步**: 更新 `replay-failed-report.js` 以支持 MCP 测试报告回放

### 5.2 验证步骤

执行清扫后，运行以下命令验证：

```bash
# 验证 MCP 核心测试仍然有效
npm run smoke:mcp-job
npm run smoke:mcp-stream
npm run smoke:mcp-visual-anchor

# 验证质量门禁仍然有效
npm run gate:step8

# 验证 MCP 配置工具仍然有效
npm run mcp:verify
```

---

## 📌 6. 总结

### 删除统计
- **脚本文件**: 1 个 (`smoke-turn-runner.js`, 2527 行)
- **npm scripts**: 3 个
- **代码行数**: 约 2600+ 行废弃代码

### 净化统计
- **脚本文件**: 2 个需要更新/净化
  - `step8-quality-gate.js` - 删除 LLM 相关指标（约 10-15 行）
  - `replay-failed-report.js` - 更新引用和参数（约 30-40 行）

### 保留的生命线
- **MCP 核心测试**: 3 个脚本（100% 保留）
- **MCP 工具脚本**: 2 个脚本（100% 保留）
- **质量门禁**: 1 个脚本（需净化但保留核心功能）

---

**报告生成时间**: 2024-12-19  
**分析范围**: `sidecar/scripts/` 目录 + `sidecar/package.json`  
**分析深度**: 静态代码分析 + 依赖关系追踪
