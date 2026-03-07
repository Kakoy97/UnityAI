# SSOT事务 Step D / Step F 清退核验报告（2026-03-06）

## 1. 核验范围
- L1: `ssot/dictionary`、`ssot/compiler`、`ssot/artifacts`
- L2: `sidecar/src/application`、`sidecar/src/ports`、`sidecar/tests/application`
- L3: `Assets/Editor/Codex/Infrastructure/Ssot`、`Assets/Editor/Codex/Generated/Ssot`、`Assets/Editor/Codex/Tests/EditMode`

本次核验只关注 `execute_unity_transaction` 的旧链路清退与新链路闭环，不扩展到基础设施底座（鉴权、网关、门禁系统等）。

## 2. 执行摘要
- 结论：`Step D` 已完成并可用；`Step F` 运行时代码层面已完成（`steps_json` 已物理退出）。
- 旧链路可达性：未发现 `steps_json`、`TryParseSteps`、`ExecuteUnityTransactionPayloadNormalizer` 的运行时可达引用。
- 唯一未闭环项：缺少 Unity 本地 Test Runner 的全量事务组执行证据（当前环境无法直接拉起 Unity CLI）。

## 3. Step D 核验（L3 事务引擎替换）

### 3.1 Orchestration Facade 已收口
- `ExecuteUnityTransactionSsotExecutor` 仅做上下文构建 + 计划构建 + 引擎调用，不含旧 `steps_json` 解析逻辑。  
  证据：
  - `TransactionExecutionContext.TryCreate` 调用
  - `TransactionPlanModelFactory.TryBuild` 调用  
  文件：`Assets/Editor/Codex/Infrastructure/Ssot/Executors/ExecuteUnityTransactionSsotExecutor.cs`

### 3.2 事务域模块完整存在
- 已存在并分责：
  - `TransactionPlanModel.cs`
  - `TransactionPlanValidator.cs`
  - `TransactionAliasStore.cs`
  - `TransactionReferenceResolver.cs`
  - `TransactionSafetyPolicy.cs`
  - `TransactionExecutionEngine.cs`
  - `ExecuteUnityTransactionPayloadParser.cs`
  - `TransactionJson.cs`
- 目录：`Assets/Editor/Codex/Infrastructure/Ssot/Transaction`

### 3.3 核心能力与约束已实现
- 计划验证：步骤唯一、依赖顺序、循环依赖、`save_as` 唯一、保留字段拦截。  
  文件：`Assets/Editor/Codex/Infrastructure/Ssot/Transaction/TransactionPlanValidator.cs`
- `$ref` 解析：支持嵌套对象/数组递归解析；拒绝字符串插值与混合 `$ref` 对象。  
  文件：`Assets/Editor/Codex/Infrastructure/Ssot/Transaction/TransactionReferenceResolver.cs`
- 别名白名单：`target_object_id/target_path/target_object_name/scene_revision/value_*`。  
  文件：`Assets/Editor/Codex/Infrastructure/Ssot/Transaction/TransactionAliasStore.cs`
- 执行引擎：串行调度、自动注入 `write_envelope`、Undo 回滚、失败透传。  
  文件：`Assets/Editor/Codex/Infrastructure/Ssot/Transaction/TransactionExecutionEngine.cs`
- 分发绑定：`execute_unity_transaction` 走专用 parser。  
  文件：`Assets/Editor/Codex/Generated/Ssot/SsotBindings.generated.cs`

## 4. Step F 核验（旧链路物理删除）

### 4.1 `steps_json` 已从运行时代码清零
- 扫描范围：排除 `docs/`、`Library/` 后，全仓 `steps_json` 命中为 0（仅文档仍保留迁移说明）。
- 结论：无运行时双轨输入。

### 4.2 旧解析器与旧分支已清退
- `ExecuteUnityTransactionPayloadNormalizer`：
  - 源文件不存在
  - 运行时代码无引用
- 新解析器 `ExecuteUnityTransactionPayloadParser` 在位并生效。

### 4.3 DTO 与 schema 已切换到结构化 steps
- 字典：`execute_unity_transaction.input` 仅 `steps`（无 `steps_json`）。  
  文件：`ssot/dictionary/tools.json`
- AJV 产物：required 为 `steps`（无 `steps_json`）。  
  文件：`ssot/artifacts/l2/ajv-schemas.generated.json`
- DTO 产物：`ExecuteUnityTransactionRequestDto.steps` 为强类型数组。  
  文件：`Assets/Editor/Codex/Generated/Ssot/SsotDtos.generated.cs`

## 5. L2 可达性审计（事务入口门禁）
- `turnService` 在 `execute_unity_transaction` 分支强制执行 `guardExecuteUnityTransactionSteps`，失败直接 `409 + E_TRANSACTION_STEP_TOOL_FORBIDDEN`。  
  文件：`sidecar/src/application/turnService.js`
- 门禁数据源来自冻结合同（可见性策略 + transaction-enabled write 集）。  
  文件：`sidecar/src/application/ssotRuntime/transactionPolicyGuard.js`
- 合同来源为可见性产物，且有启动时守护校验。  
  文件：
  - `sidecar/src/ports/contracts.js`
  - `sidecar/src/application/ssotRuntime/startupArtifactsGuard.js`

## 6. 测试与守护结果
- Node 测试通过：
  - `ssot/compiler/tests/*.test.js`（22/22）
  - `sidecar/tests/application/ssot-batch-route.test.js`
  - `sidecar/tests/application/ssot-l1-closure-evidence.test.js`
  - `sidecar/tests/application/transaction-policy-guard.test.js`
  - `sidecar/tests/application/ssot-startup-artifacts-guard.test.js`
  - `sidecar/tests/application/ssot-l2-closure-evidence.test.js`
- Unity 测试状态：
  - 事务相关 EditMode 用例源码已就位：`Assets/Editor/Codex/Tests/EditMode/SsotTransactionExecutionTests.cs`
  - 当前环境未提供可用 Unity CLI 入口，尚缺本机 Test Runner 全量执行证据。

## 7. 残留项分类
- 运行时残留：无。
- 非运行时残留：
  - `Library/Bee/*` 仍可能出现旧类名字符串（构建缓存，不参与源码可达性）。

## 8. 完成矩阵
| 项目 | 状态 | 说明 |
|---|---|---|
| Step D.1-D.4（引擎模块 + Executor 替换 + `$ref` + Undo） | 完成 | 已在 L3 模块与测试中落地 |
| Step D.5-D.8（上下文注入 + 失败透传） | 完成 | `TransactionExecutionEngine` 已实现 |
| Step F.1（删除 `steps_json` 输入） | 完成 | 运行时代码零命中 |
| Step F.2（删除旧 DTO / 兼容分支） | 完成 | Normalizer 清退，Parser 接管 |
| Step F.3（旧事务 fixtures 清理） | 完成 | 运行时与测试代码未见旧口径 |
| Step F.4（文档更新） | 完成 | 迁移与核验说明已落盘 |
| Unity Test Runner 事务组全量证据 | 待补证 | 需在本机 Unity 环境执行并留档 |

## 9. 结论
- 在不触碰底座基础设施的前提下，`execute_unity_transaction` 的旧链路已实现代码层彻底清退，主链路已统一到结构化 `steps + save_as/$ref`。
- 可继续进入下一阶段收口；建议先补齐 Unity 本机事务组 Test Runner 证据，作为最终验收附件。
