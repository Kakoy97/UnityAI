# Codex Unity 具身代理重构实施方案（Formal Plan v1.1）

- 文档版本: v1.1
- 日期: 2026-02-24
- 范围: Unity Editor + Sidecar + MCP（Cursor）
- 目标: 从“可控执行管线”演进为“具备感知、约束、执行、验证闭环的具身代理”

## 1. 现状与问题

当前已具备:
1. 文件动作/视觉动作执行能力
2. 超时、取消、重试、错误码反馈
3. MCP 任务链路（submit/status/cancel）
4. smoke + step8 门禁基础

当前缺口:
1. MCP 对外缺少 Unity 读工具（Eyes）
2. `resources/list` / `resources/read` 未实现
3. 无 context 时会退回默认占位 context，可能误导规划
4. `query_unity_components` 仍是内部桥接，不是公开可组合能力
5. 写入前缺少读取新鲜度硬约束（盲写风险）
6. 对象定位偏 path，场景变化后易失配
7. 回传以状态为主，缺少结构化“预期 vs 实际”差异

## 2. 目标结构

## 2.1 感知层（Eyes）

MCP 公开读工具（最低集）:
1. `get_current_selection`
2. `get_hierarchy_subtree`
3. `get_gameobject_components`
4. `get_prefab_info`
5. `get_compile_state`
6. `get_console_errors`

可选增强:
1. `capture_scene_view`

### 2.1.1 层级读取预算（防 Token 爆炸）

`get_hierarchy_subtree` 必须强制预算参数:
1. `depth`（默认 1，最大 3）
2. `node_budget`（默认 200）
3. `char_budget`（默认 12000）

响应必须包含:
1. `truncated`（bool）
2. `truncated_reason`（如 `depth_limit`, `node_budget`, `char_budget`）
3. `returned_node_count`

## 2.2 规划层（Brain）

固定流程:
1. `read`
2. `plan`
3. `confirm`（策略化）
4. `execute`
5. `verify`

禁止默认“猜测后执行”。

## 2.3 执行层（Hands）

写工具拆分:
1. `apply_script_actions`
2. `apply_visual_actions`

写工具统一支持:
1. `dry_run`
2. `preconditions`
3. 基于读快照 token 的执行约束

## 2.4 验证层（Feedback）

执行后强制二次读取，返回:
1. `expected`
2. `actual`
3. `diff`
4. `verification_passed`

### 2.4.1 两级验证策略（防性能劣化）

Level A（必做）:
1. 目标对象/目标组件级精准 Diff（仅本次动作相关字段）

Level B（轻量哨兵）:
1. 关键路径存在性
2. 目标组件数量变化
3. 目标对象 active/enable 关键状态

禁止默认做全对象深度序列化 Diff。

## 2.5 约束层（Safety）

硬约束:
1. 无读不写（`E_READ_REQUIRED`）
2. 写请求必须携带 `based_on_read_token`
3. token 失效即拒绝执行（`E_STALE_SNAPSHOT`）

### 2.5.1 Token 失效规则（修订）

主判据:
1. `scene_revision` 不一致立即失效

辅判据:
1. `hard_max_age_ms` 超时失效（兜底，不依赖短 TTL）

事件触发失效:
1. `HierarchyChanged`
2. `UndoRedoPerformed`
3. `CompileStarted` / Domain Reload

结论:
1. 不采用“仅短 TTL”
2. 也不采用“无限期有效”
3. 采用“revision 驱动 + hard age 兜底”

## 3. 分阶段实施计划

## Phase 0: 基线冻结与低风险清理（1-2 天）

目标:
1. 冻结当前行为基线
2. 清理已证实无引用的历史脚本产物（如 AIGenerated 样本）

门禁:
1. `smoke:*` 与 `gate:step8` 不劣化
2. Unity 面板主链路无回退

## Phase 1: Eyes 最小上线（1 周）

交付:
1. `get_current_selection` + `get_gameobject_components` 先落地
2. `get_hierarchy_subtree` 按预算机制落地（depth/node/char）
3. `resources/list` + `resources/read` 落地

门禁:
1. Cursor 可独立读取当前选中对象和组件
2. 读取结果可见 `read_token`

## Phase 2: Safety 上线（3-5 天）

交付:
1. `read_token` 结构统一（`scene_revision`, `object_id`, `issued_at`, `hard_max_age_ms`）
2. 所有写工具强制 `based_on_read_token`
3. 新错误码: `E_READ_REQUIRED`, `E_STALE_SNAPSHOT`, `E_PRECONDITION_FAILED`

门禁:
1. 未携带 token 的写请求必须失败
2. revision 不一致的写请求必须失败

## Phase 3: Hands 拆分与前置校验（1 周）

交付:
1. `apply_script_actions` / `apply_visual_actions`
2. `dry_run=true` 完整预执行报告
3. `preconditions` 支持对象存在/组件存在/编译空闲
4. 对象定位升级为 `object_id + path` 双锚点

门禁:
1. precondition 失败时不得落地写入
2. 双锚点冲突时拒绝执行并返回可恢复错误

## Phase 4: Brain 流程固化（1 周）

交付:
1. 流程强制为 `read -> plan -> confirm -> execute -> verify`
2. 将内部 `query_unity_components` 能力外显为公开读工具
3. `submit_unity_task` 保留为兼容包装器，内部走新流程

门禁:
1. 默认任务必须先读后写
2. 计划可追溯引用的 `read_token`

## Phase 5: Feedback 闭环（3-5 天）

交付:
1. 两级验证策略正式上线
2. 执行报告增加 `verification.expected/actual/diff`
3. 指标新增:
   - `verification_pass_rate`
   - `stale_token_reject_rate`
   - `precondition_fail_rate`

门禁:
1. 每个写任务都有验证结果
2. step8 报表可读上述新指标

## 4. 协议草案（关键字段）

## 4.1 读响应

```json
{
  "ok": true,
  "data": {},
  "read_token": {
    "token": "rt_...",
    "scene_revision": "rev_...",
    "object_id": "go_...",
    "issued_at": "2026-02-24T12:00:00.000Z",
    "hard_max_age_ms": 180000
  }
}
```

## 4.2 层级读取请求（带预算）

```json
{
  "target_object_id": "go_...",
  "depth": 2,
  "node_budget": 200,
  "char_budget": 12000
}
```

## 4.3 写请求

```json
{
  "based_on_read_token": "rt_...",
  "dry_run": false,
  "preconditions": [
    { "type": "object_exists", "object_id": "go_..." },
    { "type": "component_exists", "object_id": "go_...", "component": "UnityEngine.UI.Image" }
  ],
  "actions": []
}
```

## 4.4 写响应（含验证）

```json
{
  "ok": true,
  "execution": {
    "applied_count": 2,
    "rejected_count": 0
  },
  "verification": {
    "verification_passed": true,
    "expected": {},
    "actual": {},
    "diff": [],
    "sentinel": {
      "path_exists": true,
      "component_count_delta": 1
    }
  }
}
```

## 5. 兼容与发布策略

保留旧工具（过渡期）:
1. `submit_unity_task`
2. `get_unity_task_status`
3. `cancel_unity_task`

Feature Flags:
1. `ENABLE_MCP_EYES`
2. `ENABLE_STRICT_READ_TOKEN`
3. `ENABLE_SPLIT_WRITE_TOOLS`
4. `ENABLE_VERIFY_DIFF_REPORT`

发布顺序:
1. 先灰度读工具
2. 再灰度 token 强校验
3. 最后切换默认到新编排

## 6. 测试与门禁矩阵

功能门禁:
1. 读工具独立可用，返回 `read_token`
2. 无 token 写请求失败（`E_READ_REQUIRED`）
3. revision 不一致写请求失败（`E_STALE_SNAPSHOT`）
4. dry-run 不落地
5. 写后必有结构化 diff

性能门禁:
1. `get_hierarchy_subtree` 在预算内稳定返回
2. token 校验不引入明显错误风暴
3. verify 不引起主线程明显卡顿

回归门禁:
1. `smoke:*` 全通过
2. `gate:step8` 不低于既有阈值

## 7. 新增高风险项（纳入治理）

1. 对象定位风险: path 漂移导致误命中  
应对: `object_id + path` 双锚点 + precondition

2. 编译/域重载窗口风险: read 与 execute 间世界状态变化  
应对: 事件驱动 token 失效 + `WAITING_FOR_UNITY_RELOAD` 可恢复流程

3. 双链路迁移风险: 新旧流程并存导致行为分叉  
应对: feature flag 严格分流 + 阶段收口旧逻辑

## 8. 里程碑建议

1. 周 1: Phase 0 + Phase 1
2. 周 2: Phase 2 + Phase 3
3. 周 3: Phase 4 + Phase 5
4. 周 4: 稳定化、指标对齐、旧链路收口评估

## 9. 执行结论

本方案采用“先感知、后约束、再拆分执行、最后验证闭环”的顺序。  
Go/No-Go 以阶段门禁和 step8 指标为准，不满足门禁不得进入下一阶段。

