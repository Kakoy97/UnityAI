# MCP工具开发痛点记录

日期：2026-03-06  
状态：待解决

---

## 痛点1：两步式操作的Token失效问题

### 问题描述

在执行需要多步操作的任务时，第一步写操作（如`create_object`）会改变场景版本（`scene_revision`），导致旧的token立即失效。必须重新获取token才能执行后续操作，增加了不必要的往返通信。

### 典型场景

**示例：创建对象并设置属性**
1. 获取token → 创建对象（成功，但场景版本变了）
2. 使用旧token执行后续操作 → `E_SCENE_REVISION_DRIFT` 失败
3. 重新获取token → 执行后续操作

**影响：**
- 增加了不必要的token获取步骤
- 增加了往返通信次数
- 降低了操作效率
- 容易出错（忘记重新获取token）

### 当前状态

- Token TTL是3分钟，时间足够
- 主要失效原因是`scene_revision`不匹配，不是时间过期
- 写操作不会自动返回新token（`read_token_candidate`为空）
- 必须手动调用读工具获取新token

---

## 痛点2：新增MCP指令需要手写和手动注册

### 问题描述

当前新增MCP工具需要多个手写步骤，未完全走SSOT流水线，存在大量重复劳动和耦合。

### 当前流程

新增一个MCP工具需要：

1. **SSOT字典**：在`ssot/dictionary/tools.json`添加工具定义
2. **编译产物**：运行`npm run ssot:build`生成L2/L3产物
3. **定义文件**：手写`sidecar/src/mcp/commands/definitions/<tool>.js`桥接文件
4. **Validator**：手写`sidecar/src/mcp/commands/<tool>/validator.js`（虽然可以从SSOT获取schema，但仍需手写文件）
5. **Handler**：手写`sidecar/src/mcp/commands/<tool>/handler.js`
6. **注册导入**：在`sidecar/src/mcp/commands/commandDefinitionManifest.js`手动添加导入（300+行）
7. **重启服务**：必须重启npm才能生效

### 存在的问题

- **Schema部分已解耦**：从SSOT生成，但定义文件仍需手写桥接代码
- **Handler/Validator未完全解耦**：仍需手写每个工具的处理逻辑
- **注册流程未自动化**：需要在manifest中手动添加导入
- **缺乏模板化**：每个工具都需要重复编写相似代码

### 代码重复度分析

经过代码检查发现，这些"手写"文件实际上**高度模板化**，只有极少数字段不同：

**1. 定义文件（definitions/*.js）**
- **重复度：90%+**
- 只有以下字段不同：
  - 工具名（`name`）
  - HTTP路径（`path`）
  - turnService方法名（`turnServiceMethod`）
  - fallback描述（`fallbackDescription`）
- 其他代码完全相同

**2. Validator文件（<tool>/validator.js）**
- **重复度：100%**
- 只有以下字段不同（**不是功能差异，只是命名差异**）：
  - `TOOL_NAME`常量（"add_component" vs "create_object"）
  - 函数名（`validateAddComponent` vs `validateCreateObject`）
- 验证逻辑完全相同：都是调用`getValidatorRegistrySingleton().validateToolInput(TOOL_NAME, payload)`
- **结论**：Validator文件没有功能差异，完全可以自动生成

**3. Handler（turnService.js中的方法）**
- **重复度：100%**
- 所有方法都是一行代码：
  ```javascript
  async xxxForMcp(body) {
    return this.dispatchSsotToolForMcp("tool_name", body);
  }
  ```
- 只有工具名不同

**结论**：这些文件都是**高度模板化的通用逻辑**，完全可以自动生成，不需要手写。

### 真正的功能逻辑位置

**L2 (Sidecar) 层**：
- Validator：只是调用SSOT schema验证，没有业务逻辑差异
- Handler：只是调用`dispatchSsotToolForMcp`，没有业务逻辑差异

**L3 (Unity) 层**：
- **真正的功能逻辑在Executor中**：`Assets/Editor/Codex/Infrastructure/Ssot/Executors/<Tool>SsotExecutor.cs`
- 例如：
  - `AddComponentSsotExecutor.cs`：解析组件类型、添加到GameObject、错误处理等
  - `CreateObjectSsotExecutor.cs`：根据object_kind创建不同类型的GameObject
- **这些Executor才是需要手写的业务逻辑**，每个工具有不同的Unity操作逻辑

**总结**：
- L2的文件（定义、Validator、Handler）都是模板代码，可以自动生成
- L3的Executor才是真正的功能差异点，需要手写业务逻辑

### 理想状态

完全走SSOT流水线，实现：
- **Handler/Validator自动生成或模板化**：基于SSOT定义自动生成或使用模板
- **注册流程自动化**：新增工具自动注册，无需手动修改manifest
- **完全解耦**：新增工具只需修改SSOT字典，其他步骤自动化完成

---

---

## 痛点3：实际使用体验问题（AI使用视角）

### 问题描述

从AI实际使用MCP工具的角度，存在以下影响效率和体验的问题：

### 具体痛点

**1. 查询次数过多**
- 需要多次查询才能获取完整信息（如分别查询x和y坐标）
- 无法一次性获取所需的所有信息
- 增加了往返通信次数和延迟

**2. 参数格式不确定**
- 有时候不确定参数的具体格式（如颜色值范围、坐标系统等）
- 需要查询SSOT字典才能确认，增加了额外步骤
- 工具定义中的参数说明可能不够详细

**3. 错误信息不够友好**
- Token失效时只返回错误码和简单消息，没有明确提示下一步该做什么
- 需要我"记住"token失效后要重新获取，容易忘记
- 错误信息缺乏可操作的指导

**4. 操作步骤繁琐**
- 创建对象并设置属性需要：获取token → 创建 → 获取新token → 设置属性
- 步骤多，容易出错
- 虽然可以用事务工具，但需要先创建对象获取object_id，无法完全在一个事务中完成

**5. 响应延迟感知明显**
- 每次调用都需要等待往返（MCP Client → Sidecar → Unity → 返回）
- 多个步骤串联时，总延迟累积明显
- **与写脚本的差异**：
  - 写脚本：可以一次性规划完整流程，脚本执行时串行但我不需要等待中间结果
  - MCP工具：必须分步调用，每次都要等待返回才能继续，无法一次性规划完整流程
  - 关键差异：**脚本是"规划-执行"分离，MCP是"规划-执行-等待-规划-执行"循环**

**6. 不确定操作顺序**
- 不确定哪些操作可以并行，哪些必须串行
- 不确定是否需要先查询再操作，还是可以直接操作
- 缺乏操作最佳实践的明确指导

**7. Token管理负担**
- 需要主动管理token的生命周期
- 写操作后需要"记住"重新获取token
- Token失效时没有自动重试机制

### 与写脚本的对比

**写脚本的优势：**
- 可以一次性规划完整流程，然后执行
- 不需要管理token，不需要等待中间结果
- 错误处理可以统一规划
- 执行时串行，但规划时可以并行思考

**MCP工具的劣势：**
- 必须分步调用，每次都要等待返回
- 需要管理token生命周期
- 无法一次性规划完整流程
- 每次调用都是"规划-执行-等待"的循环

**关键差异：**
- **脚本**：规划阶段可以完整思考，执行阶段串行但我不需要参与
- **MCP工具**：必须"规划-执行-等待-规划-执行"循环，每一步都需要我的参与和等待

### 影响

- **效率低**：多次往返、多次查询、步骤繁琐，无法一次性规划
- **易出错**：容易忘记重新获取token、参数格式错误
- **体验差**：响应慢、错误信息不友好、操作不直观，需要频繁等待和决策

---

## 后续计划

以上痛点待后续推动解决，当前先记录在此文档中。
