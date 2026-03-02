# Codex-Unity 大文件解耦收口蓝图（R15-SPLIT）
## 0. 目标与边界

### 0.1 目标
1. 将当前 `LOC >= 1000` 的核心大文件从“中心化混合职责”改造为“职责可追踪、模块可替换、扩展不侵入主干”。
2. 保持 MCP/Unity 对外契约稳定，优先做“内部拆分 + facade 兼容”，避免一次性断崖升级。
3. 给后续 UI V1/V2 能力迭代提供低耦合骨架（读链路、写链路、错误模型、契约快照）。

### 0.2 本轮不做
1. 不重写协议语义（字段名和主错误码保持兼容）。
2. 不做“功能新增优先”，本轮以“结构收口”优先。
3. 不引入新的运行时依赖（先靠现有 Node/Unity 能力完成拆分）。

### 0.3 强制约束
1. 先抽离再删除：所有大文件先变 facade，再迁移实现。
2. 每个阶段都必须有可自动回归的验收门禁。
3. 任何拆分不得破坏 fail-closed（unknown action / unknown command / OCC 失败路径）。

---

## 1. 当前大文件基线（代码事实）

### 1.1 统计口径
1. 统计范围：`sidecar/src` + `Assets/Editor/Codex`。
2. 时间点：当前仓库（本地实测）。

### 1.2 LOC>=1000 文件清单

| 文件 | LOC | 主要耦合症状（证据） |
|---|---:|---|
| `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs` | 4024 | 同文件处理 list assets/scene/prefab/ui tree/hit-test/layout validate/screenshot/error mapping（如 `GetUiTree`、`HitTestUiAtViewportPoint`、`ValidateUiLayout`、`CaptureSceneScreenshot`） |
| `sidecar/src/domain/validators.js` | 3955 | 同文件同时承载 `validateMcp*`、`validateUnity*`、`validateSetUi*`、anchor/OCC/shape 校验 |
| `Assets/Editor/Codex/Application/ConversationController.cs` | 3053 | 同时处理 sidecar 生命周期、状态机、编译门控、action 执行、query pull、能力上报、日志 |
| `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | 1983 | `Execute + 大量 RunXxx` primitive + 锚点解析 + 组件解析 + Undo 细节混在一起 |
| `Assets/Editor/Codex/Domain/SidecarContracts.cs` | 1454 | 大量 Request/Response/Payload/DTO 聚合在单文件，跨 turn/action/query/ui |
| `sidecar/src/utils/turnUtils.js` | 1277 | 作为 utils 却依赖 application（`turnPayloadBuilders`、`turnPolicies`、`jobLease`） |
| `sidecar/src/mcp/commands/index.js` | 1228 | 命令定义集中式 `MCP_COMMAND_DEFINITIONS`，新增命令主干侵入 |
| `sidecar/src/application/mcpGateway/mcpGateway.js` | 1158 | 同时处理 submit/status/cancel/heartbeat、Unity 回执归一、流订阅、lease、metrics |
| `sidecar/src/domain/turnStore.js` | 1052 | 状态机迁移、事件追加、TTL 清理、持久化恢复、timer 管理集中 |

### 1.3 关键证据点（函数/入口）
1. `validators.js`：`validateUnityCompileResult`、`validateMcpSubmitUnityTask`、`validateMcpSetUiProperties`、`validateSetUiRectTransformPayload` 在同一文件。
2. `commands/index.js`：`const MCP_COMMAND_DEFINITIONS = Object.freeze([...])` 聚合所有 command schema/描述。
3. `UnityRagReadService.cs`：`GetUiTree`、`CaptureSceneScreenshot`、`HitTestUiAtViewportPoint`、`ValidateUiLayout` 并存于单类。
4. `ConversationController.cs`：`StartSidecarAsync`、`ReportCapabilitiesAsync`、`ExecutePendingActionAndReportAsync`、`TryHandlePulledReadQueryAsync` 并存于单类。
5. `UnityVisualActionExecutor.cs`：`Execute` + `RunAddComponent/RunCreateGameObject/RunSetUiText*` 系列集中。

---

## 2. 拆分策略总览

### 2.1 先后顺序
1. 先拆 L2（JS）：风险更低、反馈更快、可直接靠 CI 验证。
2. 再拆 L3（C#）：维持 Query/Action 对外行为不变，只动内部实现位置。
3. 最后收口资产：门禁脚本、测试矩阵、验收文档统一更新。

### 2.2 目标架构（落地约束）
1. `Facade + Feature Module`：原大文件保留导出入口，内部转调新模块。
2. `Single Writer`：错误归一、状态迁移、read_token/anchor 规则每类只保留一个权威入口。
3. `Contract Freeze`：`tool schema`、`validator`、`contracts` 三方快照一致性持续 gate。

### 2.3 完成判定（硬指标）
1. 本轮 9 个大文件全部降到 `< 900 LOC`（`SidecarContracts` 可放宽到 `< 1000`，但必须按域拆分）。
2. 新增一个 command 不再修改大段中心化定义（允许 registry 汇总点 1 处改动）。
3. `utils -> application` 反向依赖清零。
4. Sidecar + Unity 回归门禁全绿。

---

## 3. Commit-by-Commit 执行方案

## 3.1 Commit 1：L2 验证器与工具层解耦（低风险优先）

### 目标
1. 优先拆 `validators.js` 与 `turnUtils.js`，降低跨层耦合。
2. 保持对外函数名不变，避免全仓大规模改调用点。

### 文件级改动清单
1. `sidecar/src/domain/validators.js`（改为 facade）
2. `sidecar/src/domain/validators/core.js`（新增）
3. `sidecar/src/domain/validators/mcpWriteValidators.js`（新增）
4. `sidecar/src/domain/validators/unityCallbackValidators.js`（新增）
5. `sidecar/src/domain/validators/uiPropertyValidators.js`（新增）
6. `sidecar/src/domain/validators/readQueryValidators.js`（新增）
7. `sidecar/src/utils/turnUtils.js`（改为 facade）
8. `sidecar/src/utils/turn/ids.js`（新增）
9. `sidecar/src/utils/turn/errors.js`（新增）
10. `sidecar/src/utils/turn/hierarchy.js`（新增）
11. `sidecar/src/utils/turn/mcpStatus.js`（新增）
12. `sidecar/src/utils/turn/snapshot.js`（新增）

### 验收标准
1. `validators.*.test.js`、`ui-v1-tool-schema-validator-parity.test.js` 全绿。
2. `r10-responsibility-boundary.test.js` 不再出现 `utils -> application` 反向依赖告警。

---

## 3.2 Commit 2：L2 命令与网关编排解耦

### 目标
1. 将 `commands/index.js` 从“命令全集定义文件”变为“manifest 聚合器”。
2. 将 `mcpGateway.js` 拆为 submit/lifecycle/report/metrics 子模块。

### 文件级改动清单
1. `sidecar/src/mcp/commands/index.js`（改为聚合入口）
2. `sidecar/src/mcp/commands/_shared/commandManifest.js`（新增）
3. `sidecar/src/mcp/commands/*/manifest.js`（新增，按命令落地）
4. `sidecar/src/mcp/commandRegistry.js`（最小接入聚合结果）
5. `sidecar/src/application/mcpGateway/mcpGateway.js`（改为 orchestrator）
6. `sidecar/src/application/mcpGateway/submitService.js`（新增）
7. `sidecar/src/application/mcpGateway/unityReportNormalizer.js`（新增）
8. `sidecar/src/application/mcpGateway/leaseFacade.js`（新增）
9. `sidecar/src/application/mcpGateway/metricsView.js`（新增）
10. `sidecar/src/domain/turnStore.js`（改为 state facade）
11. `sidecar/src/domain/turn/turnStateMachine.js`（新增）
12. `sidecar/src/domain/turn/turnSnapshotPersistence.js`（新增）

### 验收标准
1. `r11-command-boundary-guard.js` 对新结构通过。
2. `protocol-write-consistency.test.js`、`mcp-tool-schema-minimal.test.js`、`r11-command-contract-snapshot.test.js` 全绿。

---

## 3.3 Commit 3：L3 读链路拆分（UnityRagReadService 降维）

### 目标
1. 将 `UnityRagReadService` 拆为可独立测试的 read 子服务。
2. 保留现有 Query Handler 与对外 response 结构，降低风险。

### 文件级改动清单
1. `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`（改为 facade）
2. `Assets/Editor/Codex/Infrastructure/Read/AssetSceneReadService.cs`（新增）
3. `Assets/Editor/Codex/Infrastructure/Read/UiTreeReadService.cs`（新增）
4. `Assets/Editor/Codex/Infrastructure/Read/UiHitTestReadService.cs`（新增）
5. `Assets/Editor/Codex/Infrastructure/Read/UiLayoutReadService.cs`（新增）
6. `Assets/Editor/Codex/Infrastructure/Read/ScreenshotReadService.cs`（新增）
7. `Assets/Editor/Codex/Infrastructure/Read/ReadErrorMapper.cs`（新增）
8. `Assets/Editor/Codex/Infrastructure/Queries/Handlers/*.cs`（按需改注入方式）

### 验收标准
1. `UnityRagReadServiceUiTreeTests.cs`、`UnityRagReadServiceHitTestViewportTests.cs`、`UnityUiLayoutValidatorTests.cs`、`UnityVisualReadChainTests.cs` 全绿。
2. `UnityRagReadService.cs` LOC 显著下降并只保留 orchestration。

---

## 3.4 Commit 4：L3 控制器与执行器拆分

### 目标
1. 降低 `ConversationController` 的“总线式”职责。
2. 将 `UnityVisualActionExecutor` 收口为“registry dispatch + result normalize”。

### 文件级改动清单
1. `Assets/Editor/Codex/Application/ConversationController.cs`（改为 facade）
2. `Assets/Editor/Codex/Application/Conversation/TurnStateCoordinator.cs`（新增）
3. `Assets/Editor/Codex/Application/Conversation/PendingActionCoordinator.cs`（新增）
4. `Assets/Editor/Codex/Application/Conversation/QueryPollingCoordinator.cs`（新增）
5. `Assets/Editor/Codex/Application/Conversation/CapabilityReporter.cs`（新增）
6. `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`（改为 dispatch）
7. `Assets/Editor/Codex/Infrastructure/Actions/LegacyPrimitiveActionHandlers.cs`（新增，承接 RunXxx）
8. `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`（补注册）

### 验收标准
1. `UnityQueryControllerClosureTests.cs`、`UnityRuntimeRecoveryTests.cs`、`UnityVisualActionRegistryExecutorTests.cs`、`CompositeVisualActionHandlerTests.cs` 全绿。
2. `UnityVisualActionExecutor.cs` 不再包含大段 primitive 业务实现。

---

## 3.5 Commit 5：契约文件拆分与收口

### 目标
1. 将 `SidecarContracts.cs` 按域拆分，降低冲突面与认知负担。
2. 保持类型名与序列化字段不变。

### 文件级改动清单
1. `Assets/Editor/Codex/Domain/SidecarContracts.cs`（保留汇总/partial）
2. `Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Core.cs`（新增）
3. `Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Turn.cs`（新增）
4. `Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Action.cs`（新增）
5. `Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Query.cs`（新增）
6. `Assets/Editor/Codex/Domain/Contracts/SidecarContracts.UiVision.cs`（新增）

### 验收标准
1. `SidecarContractsSnapshotTests.cs`、`SidecarContractsReadTokenTests.cs`、`SidecarContractsExtensibilityDtoTests.cs` 全绿。
2. 不出现 JSON 字段名漂移或 DTO 兼容性回归。

---

## 4. 风险与回滚策略

### 4.1 主要风险
1. facade 拆分后导出顺序变化导致 Node 循环引用。
2. Unity 部分文件拆分引起 asm 编译顺序/命名空间冲突。
3. 契约拆分时误改字段命名导致反序列化失败。

### 4.2 回滚策略
1. 每个 Commit 独立可回滚，不做跨阶段大杂烩提交。
2. 保留旧入口 API；新模块仅由旧入口转调。
3. 每阶段必须跑对应 QA 套件，未通过不得进入下一阶段。

---

## 5. 验收门禁

### 5.1 Sidecar（CI 强制）
1. `npm test` 通过。
2. `npm run gate:r10-responsibility` 通过。
3. `npm run gate:r10-contract-snapshot` 通过。
4. `npm run gate:r11-command-boundary` 通过。

### 5.2 Unity（发布前门禁）
1. `UnityQueryRegistryTests.cs`
2. `UnityVisualActionRegistryExecutorTests.cs`
3. `UnityRagReadServiceUiTreeTests.cs`
4. `UnityUiLayoutValidatorTests.cs`
5. `SidecarContractsSnapshotTests.cs`

---

## 6. 完成后架构效果（预期）

1. 新增 MCP Command：默认只改 `commands/<name>/manifest.js + validator.js + handler.js`，中心聚合改动最小化。
2. 新增 UI 读规则：默认只改 `UiLayoutReadService` 对应 rule 模块与测试，不触发 `ConversationController` 主干侵入。
3. 新增 Action Primitive：通过 handler 注册扩展，不再堆积到 `UnityVisualActionExecutor`。

---

## 7. 执行顺序与任务矩阵（R15-SPLIT）

### 7.1 执行顺序（按依赖）
1. `Phase A / L2 解耦收口`：R15-SPLIT-L2-01、R15-SPLIT-L2-02、R15-SPLIT-L2-03、R15-SPLIT-L2-04、R15-SPLIT-L2-05  
2. `Phase B / L3 解耦收口`：R15-SPLIT-L3-01、R15-SPLIT-L3-02、R15-SPLIT-L3-03、R15-SPLIT-L3-04  
3. `Phase C / 资产与验证收口`：R15-SPLIT-ASSET-01、R15-SPLIT-QA-01、R15-SPLIT-QA-02、R15-SPLIT-E2E-01

### 7.2 任务矩阵

| 任务ID | 阶段 | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| R15-SPLIT-L2-01 | Phase A | validators 拆分 | `sidecar/src/domain/validators.js`、`sidecar/src/domain/validators/*.js` | 验证器按域拆分，原入口 facade 保持兼容 | `validators` 全量测试 + schema/validator parity 全绿 |
| R15-SPLIT-L2-02 | Phase A | turnUtils 去耦 | `sidecar/src/utils/turnUtils.js`、`sidecar/src/utils/turn/*.js` | 消除 `utils -> application` 反向依赖 | `r10-responsibility-boundary.test.js` 全绿 |
| R15-SPLIT-L2-03 | Phase A | command manifest 化 | `sidecar/src/mcp/commands/index.js`、`sidecar/src/mcp/commands/*/manifest.js`、`sidecar/src/mcp/commandRegistry.js` | 新增命令不再复制中心 schema 大段定义 | `r11-command-boundary` + tools schema 快照通过 |
| R15-SPLIT-L2-04 | Phase A | mcpGateway 编排拆分 | `sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/application/mcpGateway/*.js` | submit/report/lease/metrics 子模块化 | `protocol-write-consistency`、`mcp-write-readiness` 全绿 |
| R15-SPLIT-L2-05 | Phase A | turnStore 状态机拆分 | `sidecar/src/domain/turnStore.js`、`sidecar/src/domain/turn/*.js` | 状态迁移与持久化恢复分离 | `job-lifecycle.test.js`、`unity-dispatcher-reboot-wait.test.js` 全绿 |
| R15-SPLIT-L3-01 | Phase B | UnityRagReadService 拆分 | `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`、`Assets/Editor/Codex/Infrastructure/Read/*.cs` | 读能力按 UI tree/hit-test/layout/screenshot/asset scene 分层 | `UnityVisualReadChainTests.cs` + RAG read 系列全绿 |
| R15-SPLIT-L3-02 | Phase B | ConversationController 拆分 | `Assets/Editor/Codex/Application/ConversationController.cs`、`Assets/Editor/Codex/Application/Conversation/*.cs` | controller 仅保留编排，状态机与轮询协同分离 | `UnityQueryControllerClosureTests.cs`、`UnityRuntimeRecoveryTests.cs` 全绿 |
| R15-SPLIT-L3-03 | Phase B | Action Executor 收口 | `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`、`Assets/Editor/Codex/Infrastructure/Actions/*.cs` | executor 仅 dispatch/normalize，primitive 落 handler | `UnityVisualActionRegistryExecutorTests.cs`、`AtomicSafeAdmissionTests.cs` 全绿 |
| R15-SPLIT-L3-04 | Phase B | SidecarContracts 分域文件化 | `Assets/Editor/Codex/Domain/SidecarContracts.cs`、`Assets/Editor/Codex/Domain/Contracts/*.cs` | DTO 按域拆分但契约不变 | `SidecarContractsSnapshotTests.cs`、`SidecarContractsExtensibilityDtoTests.cs` 全绿 |
| R15-SPLIT-ASSET-01 | Phase C | 门禁资产收口 | `sidecar/scripts/r10-responsibility-guard.js`、`sidecar/scripts/r11-command-boundary-guard.js`、`sidecar/scripts/README.md` | 增补 LOC/依赖方向门禁，文档同步 | 脚本可重复执行，输出与新结构一致 |
| R15-SPLIT-QA-01 | Phase C | Sidecar 回归收口 | `sidecar/tests/application/*`、`sidecar/tests/domain/*` | facade 兼容 + 行为一致性回归 | `npm test` 全绿 |
| R15-SPLIT-QA-02 | Phase C | Unity 回归收口 | `Assets/Editor/Codex/Tests/EditMode/*.cs` | 读链路/写链路/契约快照回归 | EditMode 关键测试全绿 |
| R15-SPLIT-E2E-01 | Phase C | 验收文档收口 | `Assets/Docs/Phase10-Large-File-Decoupling-Acceptance.md`（新增） | 固化拆分后新增 command/action/query 最短路径 | 可按文档完成一次端到端验收 |

---

## 8. 建议推进顺序（实践版）
1. 先做 `R15-SPLIT-L2-01` 和 `R15-SPLIT-L2-02`，这两项可最快降低耦合且回归成本最低。
2. 然后推进 `R15-SPLIT-L3-01`，优先把 `UnityRagReadService` 降维，减少后续 UI 能力扯皮。
3. 最后做 contracts 分域与资产收口，避免中途快照抖动影响迭代效率。
