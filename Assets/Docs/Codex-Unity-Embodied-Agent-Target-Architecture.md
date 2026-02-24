# Codex Unity 目标结构草案（Embodied Agent: Eyes + Hands）

- 文档版本: v1.0
- 更新时间: 2026-02-24
- 目的: 明确“Cursor 真正具备看与做能力”的目标结构，用于重构讨论对齐。

## 1. 目标定义

目标不是“让模型猜然后执行”，而是:
1. 能读取 Unity 当前事实（眼睛）
2. 基于事实规划（大脑）
3. 受控执行变更（手脚）
4. 执行后自动核验（闭环）

## 2. 目标分层

### 2.1 感知层（Eyes）

对外公开 MCP 读工具（最小集合）:
1. `get_current_selection`
2. `get_hierarchy_subtree`
3. `get_gameobject_components`
4. `get_prefab_info`
5. `get_compile_state`
6. `get_console_errors`

可选增强:
1. `capture_scene_view`（截图/可视化快照）
2. `query_asset_dependencies`

### 2.2 规划层（Brain）

固定流程:
1. 先读
2. 再规划
3. 再执行
4. 最后验证

约束:
1. 禁止“无读直接写”（除非显式强制且高风险确认）
2. 规划必须引用最近读取结果（含版本戳）

### 2.3 执行层（Hands）

写能力分离:
1. `apply_script_actions`
2. `apply_visual_actions`

执行前置:
1. precondition 检查（目标对象/组件存在性）
2. 可选 `dry_run`
3. 自动回传结构化结果

### 2.4 验证层（Verify）

执行后强制二次读取并生成差异:
1. expected
2. actual
3. diff
4. pass/fail

## 3. 推荐协议策略

1. 读操作返回 `snapshot_id` / `scene_revision`。  
2. 写操作必须携带 `based_on_snapshot_id`。  
3. 若快照过期，返回可恢复错误并要求重读。  
4. 错误码统一区分:
   - schema 类
   - precondition 类
   - runtime 类
   - stale snapshot 类

## 4. 渐进式重构路线（不推翻现有资产）

## Stage A（最小可用眼睛）
1. 新增公开 MCP 读工具（selection/components 至少二选一先落地）
2. 保持现有 `submit_unity_task` 流程不变
3. 让 Cursor 可显式调用读工具进行前置确认

## Stage B（闭环执行）
1. 引入 `read -> plan -> execute -> verify` 约束
2. 写操作引入 precondition + snapshot 版本校验
3. 统一输出结构化执行报告

## Stage C（可观测性升级）
1. 质量门禁从“通过率”扩展到“事实一致率”
2. 增加误执行率、重试率、stale snapshot 命中率
3. 与 Step8 报表打通

## 5. 与现有架构的兼容点

可直接复用:
1. 现有状态机和错误反馈系统
2. 现有视觉执行器与文件执行器
3. 现有 Step8 回归与失败回放机制
4. 现有内部 `unity.query.components` 往返链路（先内转外）

## 6. 当前不建议做的事

1. 直接重写整个 sidecar 和 Unity 控制器
2. 在没有读能力之前扩大自动执行范围
3. 把更多 prompt 技巧当成对“感知缺失”的替代

## 7. 成功判定（验收口径）

1. Cursor 可以直接调用 MCP 工具读取“当前选中对象 + 组件”  
2. 读结果可稳定用于后续写入，不依赖猜测  
3. 写入后可自动给出结构化验证差异  
4. 误执行率显著下降（由 Step8 指标量化）

