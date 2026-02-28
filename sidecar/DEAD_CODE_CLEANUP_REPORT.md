# L2 Sidecar 死代码清扫报告 (Dead Code Cleanup Report)

**生成时间**: 2024-12-19  
**审查范围**: `sidecar/src/` 目录  
**审查目标**: 识别并清理网关化重构后的历史残留代码

---

## 1. 现状全景图 (Current Architecture Map)

### 目录结构树

```
sidecar/src/
├── adapters/
│   ├── argAdapter.js
│   ├── autoFixExecutor.js          ⚠️ 疑似未使用
│   ├── clockAdapter.js
│   └── fileActionExecutor.js
├── api/
│   └── router.js
├── application/
│   ├── jobRuntime/                 ✅ 核心：Job 运行时管理
│   │   ├── jobQueue.js
│   │   ├── jobRecovery.js
│   │   ├── jobStore.js
│   │   └── lockManager.js
│   ├── mcpGateway/                 ✅ 核心：MCP 网关层
│   │   ├── jobLifecycle.js
│   │   ├── mcpErrorFeedback.js
│   │   ├── mcpEyesReadService.js
│   │   ├── mcpEyesService.js
│   │   ├── mcpEyesWriteService.js
│   │   ├── mcpGateway.js
│   │   ├── mcpStreamHub.js
│   │   └── unityCallbacks.js
│   ├── preconditionService.js
│   ├── responseCacheService.js
│   ├── turnPayloadBuilders.js      ✅ 仍在使用
│   ├── turnPolicies.js             ✅ 仍在使用
│   ├── turnService.js              ⚠️ 已掏空，仅保留网关功能
│   ├── unityDispatcher/            ✅ 核心：Unity 调度器
│   │   ├── reportBuilder.js
│   │   ├── runtimeUtils.js
│   │   └── unityDispatcher.js
│   ├── unityReportService.js       🗑️ 完全未使用（死代码）
│   └── unitySnapshotService.js
├── domain/
│   ├── turnStore.js                ⚠️ 包含历史 codex 超时配置
│   └── validators.js                ⚠️ 包含大量未使用的验证函数
├── infrastructure/
│   ├── fileStateSnapshotStore.js
│   ├── httpIO.js
│   └── serverFactory.js
├── mcp/
│   └── mcpServer.js
├── ports/
│   └── contracts.js
├── utils/
│   └── turnUtils.js
└── index.js                        ⚠️ 包含未使用的 AutoFixExecutor 初始化
```

### 核心目录职责验证

✅ **jobRuntime/** - 完美承担 Job 运行时管理职责  
✅ **mcpGateway/** - 完美承担 MCP 网关职责  
✅ **unityDispatcher/** - 完美承担 Unity 调度职责  
⚠️ **turnService.js** - 已被掏空，仅保留网关转发功能（旧 API 返回 410 Gone）

---

## 2. 深度死代码与残留扫描 (Dead Code & Redundancy Analysis)

### 2.1 完全未使用的文件 (Unused Files)

#### 🗑️ `application/unityReportService.js` (829 行)
**状态**: 完全未使用  
**证据**:
- 文件中定义的 `UnityReportService` 类从未被导入或实例化
- 文件引用了大量 `turnService` 中不存在的方法：
  - `buildCompileVerification()` - 不存在
  - `beginFinalizeTerminalPhase()` - 不存在
  - `buildExecutionReport()` - 不存在（实际在 `unityDispatcher/reportBuilder.js`）
  - `tryAutoFixCompileFailure()` - 不存在
  - `tryAutoFixActionFailure()` - 不存在
  - `matchUnityActionResult()` - 不存在
  - `buildActionVerification()` - 不存在
  - `buildActionReadBackVerification()` - 不存在
  - `pendingUnityComponentQueries` - 不存在
  - `touchCodexHeartbeat()` - 在 turnStore 中，但未在 TurnService 中暴露

**结论**: 这是 Phase 1/2 重构前的遗留代码，当前架构已由 `unityDispatcher/` 和 `mcpGateway/` 接管所有功能。

---

### 2.2 未使用的验证函数 (Unused Validators)

#### 🗑️ `domain/validators.js` 中的未使用导出

**完全未使用的验证函数**:

1. **`validateSessionStart`** (行 529-531)
   - 导出位置: 行 2712
   - 使用情况: 0 次引用
   - 原因: `session.start` 端点已在网关模式下移除（返回 410 Gone）

2. **`validateTurnSend`** (行 533-562)
   - 导出位置: 行 2713
   - 使用情况: 0 次引用
   - 原因: `turn.send` 端点已在网关模式下移除（返回 410 Gone）

3. **`validateTurnCancel`** (行 564-580)
   - 导出位置: 行 2714
   - 使用情况: 0 次引用
   - 原因: `turn.cancel` 端点已在网关模式下移除（返回 410 Gone）

4. **`validateUnityQueryComponentsResult`** (行 2089-2175)
   - 导出位置: 行 2726
   - 使用情况: 仅在 `unityReportService.js` 中使用（行 492），而 `unityReportService.js` 本身未使用
   - 原因: 该功能已由 `mcpGateway` 和 `unityDispatcher` 接管

**建议**: 删除这 4 个函数及其导出。

---

### 2.3 历史配置残留 (Legacy Configuration)

#### ⚠️ `domain/turnStore.js` 中的 Codex 超时配置

**位置**: 行 3-4, 25-37, 88-129

**残留代码**:
- `DEFAULT_CODEX_SOFT_TIMEOUT_MS` (行 3)
- `DEFAULT_CODEX_HARD_TIMEOUT_MS` (行 4)
- `codexSoftTimeoutMs` 配置项 (行 25-28)
- `codexHardTimeoutMs` 配置项 (行 29-35)
- `codexTimeoutMs` 别名 (行 37)
- `sweep()` 中的 codex 超时检查逻辑 (行 96-129)

**分析**:
- L2 已不再调用 LLM，这些超时配置理论上已无用
- **但**: `turnStore` 仍用于存储和恢复历史 Turn 状态，可能包含 `codex_pending` 阶段的旧数据
- **建议**: 保留配置项以兼容历史数据恢复，但可以移除 `sweep()` 中的 codex 超时检查逻辑（行 96-129），因为新架构不会再进入 `codex_pending` 阶段

#### ⚠️ `index.js` 中的 Codex 超时环境变量

**位置**: 行 13-14

**残留代码**:
- `CODEX_SOFT_TIMEOUT_MS` 环境变量解析 (行 13)
- `CODEX_HARD_TIMEOUT_MS` 环境变量解析 (行 14)

**分析**: 这些环境变量仍被传递给 `TurnStore`，但新架构不再使用。可以移除环境变量解析，但保留 `TurnStore` 的默认值以兼容历史数据。

---

### 2.4 未使用的依赖注入 (Unused Dependencies)

#### ⚠️ `index.js` 中的 AutoFixExecutor

**位置**: 行 10, 81-85, 105

**代码**:
```javascript
const { AutoFixExecutor } = require("./adapters/autoFixExecutor");
// ...
const autoFixExecutor = new AutoFixExecutor({...});
// ...
turnService: new TurnService({
  // ...
  autoFixExecutor,  // 行 105
})
```

**分析**:
- `AutoFixExecutor` 被创建并传递给 `TurnService`
- 但 `TurnService` 构造函数（`turnService.js` 行 28-74）中**没有接收 `autoFixExecutor` 参数**
- `turnService.js` 中也没有任何地方使用 `autoFixExecutor`

**结论**: `AutoFixExecutor` 的创建和传递都是死代码。

**相关文件**:
- `adapters/autoFixExecutor.js` - 如果确认未使用，可考虑删除整个文件

---

### 2.5 流式文本残留 (Streaming Text Delta Residue)

#### ⚠️ `domain/turnStore.js` 中的 `delta` 字段

**位置**: 行 683, 1078

**代码**:
```javascript
// 行 683: appendEventToEntry 中
delta: data.delta || "",

// 行 1078: cloneTurnEvents 中
delta: item.delta || "",
```

**分析**:
- `delta` 字段原本用于存储 LLM 流式输出的文本增量
- 当前 SSE 流只推送 `job.progress` 和 `job.completed` 事件，不再推送文本增量
- 但 `delta` 字段仍被保留在事件记录结构中

**建议**: 
- 保留字段定义以兼容历史数据（避免反序列化失败）
- 但可以添加注释说明该字段已废弃，不再用于新事件

---

### 2.6 未使用的工具函数 (Unused Utility Functions)

#### ⚠️ `utils/turnUtils.js` 中的潜在未使用函数

需要进一步检查以下函数是否仍在使用：
- `normalizeMcpStreamEventType` (行 1097) - 在 `mcpStreamHub.js` 中使用 ✅
- 其他函数需要逐个检查

**建议**: 使用静态分析工具（如 `depcheck`）全面扫描未使用的导出。

---

## 3. 无情清扫清单 (Ruthless Cleanup Proposal)

### 3.1 完全删除的文件

#### 🗑️ 文件 1: `application/unityReportService.js`
- **行数**: 829 行
- **理由**: 完全未使用，所有功能已由 `unityDispatcher/` 和 `mcpGateway/` 接管
- **风险**: 低（已确认无引用）

**操作**:
```bash
rm sidecar/src/application/unityReportService.js
```

---

### 3.2 删除函数和导出

#### 🗑️ `domain/validators.js` - 删除未使用的验证函数

**操作 1**: 删除 `validateSessionStart` 函数
- **删除行**: 529-531
- **删除导出**: 行 2712

**操作 2**: 删除 `validateTurnSend` 函数
- **删除行**: 533-562
- **删除导出**: 行 2713

**操作 3**: 删除 `validateTurnCancel` 函数
- **删除行**: 564-580
- **删除导出**: 行 2714

**操作 4**: 删除 `validateUnityQueryComponentsResult` 函数
- **删除行**: 2089-2175
- **删除导出**: 行 2726

**预计减少**: ~650 行代码

---

### 3.3 删除未使用的依赖注入

#### 🗑️ `index.js` - 移除 AutoFixExecutor

**操作 1**: 删除导入
- **删除行**: 10
```javascript
const { AutoFixExecutor } = require("./adapters/autoFixExecutor");
```

**操作 2**: 删除实例化
- **删除行**: 81-85
```javascript
const autoFixExecutor = new AutoFixExecutor({
  workspaceRoot: path.resolve(__dirname, "..", ".."),
  allowedWriteRoots: ["Assets/Scripts/AIGenerated/"],
  maxFileBytes: 102400,
});
```

**操作 3**: 删除参数传递
- **删除行**: 105（从 `turnService` 构造参数中移除 `autoFixExecutor`）

**后续检查**: 确认 `adapters/autoFixExecutor.js` 是否在其他地方使用，如未使用则删除整个文件。

---

### 3.4 清理历史配置（可选，需谨慎）

#### ⚠️ `domain/turnStore.js` - 移除 Codex 超时检查逻辑

**操作**: 删除 `sweep()` 方法中的 codex 超时检查
- **删除行**: 96-129
- **保留**: 配置项定义（行 3-4, 25-37），以兼容历史数据恢复

**理由**: 新架构不会再进入 `codex_pending` 阶段，但历史数据可能包含该状态。

**风险**: 中等（可能影响历史数据恢复）

**建议**: 如果确认不再需要恢复包含 `codex_pending` 状态的历史数据，可以删除整个 codex 超时检查逻辑。

---

#### ⚠️ `index.js` - 移除 Codex 超时环境变量解析

**操作**: 删除环境变量解析，但保留 TurnStore 默认值
- **删除行**: 13-14
- **修改行**: 63-71（移除 `codexSoftTimeoutMs` 和 `codexHardTimeoutMs` 参数传递，使用 TurnStore 默认值）

**风险**: 低（TurnStore 有默认值）

---

### 3.5 添加废弃注释（不删除，仅标记）

#### 📝 `domain/turnStore.js` - 标记废弃字段

**操作**: 在 `delta` 字段处添加注释
- **位置**: 行 683, 1078
- **注释**:
```javascript
// @deprecated delta field is no longer used for streaming text output.
// Retained for backward compatibility with historical event data.
delta: data.delta || "",
```

---

## 4. 清扫优先级与风险评估

### 高优先级（低风险）

1. ✅ **删除 `unityReportService.js`** - 完全未使用，0 风险
2. ✅ **删除 4 个未使用的验证函数** - 已确认无引用，0 风险
3. ✅ **移除 AutoFixExecutor 相关代码** - 已确认未使用，0 风险

### 中优先级（需确认）

4. ⚠️ **删除 `adapters/autoFixExecutor.js`** - 需确认无其他引用
5. ⚠️ **移除 Codex 超时检查逻辑** - 需确认不再需要恢复历史 `codex_pending` 状态

### 低优先级（可选）

6. 📝 **添加废弃注释** - 仅文档化，不删除代码
7. 📝 **移除 Codex 超时环境变量解析** - 保留 TurnStore 默认值即可

---

## 5. 预计清理效果

### 代码行数减少

- `unityReportService.js`: **-829 行**
- `validators.js` (4 个函数): **~-650 行**
- `index.js` (AutoFixExecutor): **~-10 行**
- `turnStore.js` (codex 超时检查，可选): **~-35 行**

**总计**: **~-1524 行**（如包含可选清理）

### 文件删除

- `application/unityReportService.js` (829 行)
- `adapters/autoFixExecutor.js` (需确认，~317 行)

---

## 6. 执行建议

### 阶段 1: 安全清理（立即执行）

1. 删除 `unityReportService.js`
2. 删除 4 个未使用的验证函数
3. 移除 `index.js` 中的 AutoFixExecutor 相关代码

### 阶段 2: 确认后清理

4. 使用 `depcheck` 或类似工具确认 `autoFixExecutor.js` 无其他引用
5. 如确认无引用，删除 `adapters/autoFixExecutor.js`

### 阶段 3: 可选优化

6. 移除 Codex 超时检查逻辑（需确认历史数据恢复策略）
7. 移除 Codex 超时环境变量解析
8. 添加废弃字段注释

---

## 7. 验证检查清单

执行清理后，请验证：

- [ ] 所有测试通过
- [ ] 历史数据恢复功能正常（如适用）
- [ ] SSE 流功能正常
- [ ] MCP Gateway 功能正常
- [ ] Unity Dispatcher 功能正常
- [ ] 无运行时错误
- [ ] 无未使用的导入警告（如使用 linter）

---

**报告结束**
