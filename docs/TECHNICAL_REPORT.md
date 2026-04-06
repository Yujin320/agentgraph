# 面向供应链场景的智能数据归因系统：基于可组合推理策略的 Agentic Workflow 实现

> DataAgent v2 — Technical Implementation Report
>
> 版本 2.1 | 2026-04

---

## 摘要

在企业数据分析实践中，传统 BI 工具以"查询—可视化"的单轮交互为主，难以支撑因果归因、多步推理等复杂分析需求。本文介绍 DataAgent v2 系统的设计与实现——一个面向供应链场景的智能数据归因平台。系统以 LangGraph 状态机为推理内核，提出 **Plan-Execute-Reflect 多步推理循环** 与 **可组合策略子图（Composable Strategy Sub-graphs）** 两项核心机制，实现了从"数据查询工具"到"智能分析代理"的范式升级。在供应链 POC 数据集（10 表 / 24,520 行）上，系统完成了因果归因、统计关联、趋势追踪等多类分析任务，支持 SQL 自纠错（最多 3 轮重试）和 Human-in-the-Loop SQL 审批，推理过程通过 SSE 实时流式推送至前端。

**关键词**: Agentic Workflow, LangGraph, 因果归因, Text-to-SQL, 知识图谱, Human-in-the-Loop

---

## 1. 引言

### 1.1 问题背景

企业供应链管理涉及销售、库存、生产、物流等多环节数据。当业务指标出现异常时（如外调品占比突增），分析人员需要：

1. **识别异常**：哪个指标偏离预期？
2. **溯源归因**：沿因果链路逐级追溯根本原因
3. **量化验证**：每一跳因果关系都需 SQL 查询实际数据加以验证
4. **综合判断**：结合多条路径得出结论并提供改善建议

这一过程具有 **多步骤、条件分支、中间可能失败需重试** 的特征——恰好是 Agentic Workflow 的典型应用场景，而非传统单轮 Text-to-SQL 所能覆盖。

### 1.2 现有方案局限

| 方案类别 | 代表 | 局限 |
|----------|------|------|
| ChatBI / Text-to-SQL | Vanna.ai, Chat2DB | 单轮问答，无法多步推理，SQL 出错即终止 |
| 通用 Agent 框架 | DeerFlow, CrewAI, AutoGen | 面向通用任务，缺少领域垂直的推理策略和知识图谱集成 |
| RAG 平台 | RAGFlow, Dify | 以文档检索为核心，数据库查询和因果推理能力较弱 |
| BI 工具 + AI 插件 | Tableau Ask Data, Power BI Copilot | 依赖商业平台，推理深度有限，不支持自定义策略 |

### 1.3 本文贡献

1. 提出 **四层解耦架构**（展示层 / 推理引擎层 / 知识层 / 数据层），每层可独立替换扩展
2. 设计 **Plan-Execute-Reflect 推理循环**，支持 SQL 自纠错和结果自反思
3. 实现 **可组合策略注册表（Strategy Registry）**，5 种推理策略以 LangGraph 子图形式即插即用
4. 构建 **7 阶段可插拔 Pipeline**，覆盖从数据接入到归因分析的完整流程
5. 在供应链真实场景中完成端到端验证

---

## 2. 系统架构

### 2.1 总体分层

```
┌──────────────────────────── 展示层 ────────────────────────────┐
│  双主题 UI · 实时推理流 · 交互式因果 DAG · SQL 审批编辑器       │
└──────────────────────┬─────────────────────────────────────────┘
                       │ SSE Named Events + REST API
┌──────────────────────▼─────────────────────────────────────────┐
│                   推理引擎层 (LangGraph)                         │
│                                                                   │
│  ┌────────┐ ┌──────┐ ┌────────┐ ┌─────────┐ ┌─────────┐       │
│  │ Intent │→│ Plan │→│SQL Gen │→│ Execute │→│ Reflect │       │
│  └────────┘ └──────┘ └────────┘ └─────────┘ └────┬────┘       │
│                          ↑   interrupt()          │              │
│                          └── retry ◄──────────────┘              │
│                                    └── drill / conclude ──→ END │
│  Strategy Sub-graphs: causal│statistical│comparative│trend│whatif│
└──────────────────────┬─────────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────────┐
│                     知识层                                       │
│  Neo4j 因果 KG (167 节点 / 170 边)  ·  ChromaDB Few-shot RAG    │
│  语义字典 (schema_dict.yaml)  ·  场景配置                        │
└──────────────────────┬─────────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────────┐
│                     数据层                                       │
│  SQLAlchemy 统一抽象 · DataSourceAdapter 插件接口                │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 设计原则

- **模块热插拔**：每个 Stage 和 Strategy 均通过装饰器 `@register` 注册，新增模块无需修改框架代码
- **人机协作**：关键环节（语义标注、SQL 审批）支持 `pause → 人工编辑 → resume`
- **配置驱动**：新业务场景仅需配置文件，不改代码
- **渐进构建**：每个阶段的输出独立可用，不必全部完成才能使用

---

## 3. 核心机制

### 3.1 可插拔 Pipeline 框架

系统将数据分析的完整生命周期抽象为 **7 个阶段（Stage）**，分属两条管线：

**Setup Pipeline**（每个工作空间执行一次）：

| 序号 | 阶段 | 功能 | 人工介入 |
|------|------|------|----------|
| 1 | Connect | 数据源连接验证 | 自动 |
| 2 | Introspect | 表结构扫描 + 列级统计（基数、空值率、极值） | 自动 |
| 3 | Enrich | LLM 生成中文语义标注 → `schema_dict.yaml` | **需审核** |
| 4 | Build KG | 语义 Schema → Neo4j 因果知识图谱 | **需审核** |
| 5 | Train SQL | 生成 Few-shot SQL 示例 → ChromaDB 向量化 | 自动 |

**Runtime Pipeline**（每次用户提问触发）：

| 序号 | 阶段 | 功能 |
|------|------|------|
| 6 | Text-to-SQL | ChromaDB RAG + KG Schema 聚焦 → LLM 生成 SQL → 执行 → 解读 |
| 7 | Attribution | KG 因果边遍历 → 逐节点 SQL 验证 → 偏差排序 → 归因结论 |

所有 Stage 共享统一基类 `StageBase`，通过 `StageRegistry` 管理：

```python
class StageBase(ABC):
    name: str
    pipeline_type: Literal["setup", "runtime"]
    
    @abstractmethod
    def run(self, workspace, input_data, config) -> StageResult:
        ...  # 必须幂等（可安全重跑）

@StageRegistry.register
class MyNewStage(StageBase):
    name = "my_stage"
    ...
```

### 3.2 Plan-Execute-Reflect 推理循环

推理引擎层基于 LangGraph StateGraph 实现，核心状态定义如下：

```python
class AgentState(TypedDict):
    workspace: str          # 工作空间标识
    question: str           # 用户原始问题
    strategy: str           # 路由到的推理策略
    plan: list[str]         # 分解后的子任务列表
    current_sql: str        # 当前生成的 SQL
    sql_error: str | None   # SQL 执行错误信息
    retry_count: int        # 当前重试次数
    reasoning_steps: list   # 完整推理轨迹
    pending_approval: bool  # 是否等待人工审批
    conclusion: str | None  # 最终结论
    attribution_paths: list # 归因路径（因果策略）
    chart_spec: dict | None # 图表配置
```

**六个节点的职责与转移逻辑**：

```
Intent ──→ Plan ──→ SQL Gen ──→ Execute ──→ Reflect ──→ Conclude
                       ↑                       │
                       └── SQL Error (retry<3) ─┘
```

1. **Intent 节点**：关键词匹配 + LLM 语义分类，输出意图类型和推荐策略
2. **Plan 节点**：LLM 将问题分解为可执行子任务列表
3. **SQL Gen 节点**：ChromaDB 检索相似 SQL + KG 子图 Schema → LLM 生成 SQL；重试时注入上次错误信息
4. **Execute 节点**：SQLAlchemy 执行 SQL，捕获结果或错误
5. **Reflect 节点**：LLM 评估结果质量，三路决策——重试 / 下钻 / 结论
6. **Conclude 节点**：综合全部推理步骤，生成自然语言解读 + 图表配置

**SQL 自纠错**是 Reflect 节点的关键能力。当 SQL 执行失败时，错误信息被注入下一轮 SQL 生成的 Prompt：

```
上次生成的 SQL 执行失败：
错误信息: no such column: mat_name
失败的 SQL: SELECT mat_name, SUM(qty) ...

请分析错误原因并生成修正后的 SQL。
```

系统默认最多重试 3 次，若仍失败则转入 Conclude 节点生成部分结论。

### 3.3 可组合推理策略

不同类型的分析问题需要不同的推理路径。系统设计了 **策略注册表（Strategy Registry）** 模式：

```python
class StrategyBase(ABC):
    name: ClassVar[str]
    trigger_keywords: ClassVar[list[str]]
    
    @abstractmethod
    def build_subgraph(self) -> CompiledGraph:
        """返回该策略的 LangGraph 子图"""
    
    @abstractmethod
    def can_handle(self, intent: str, question: str) -> float:
        """返回 0~1 置信度"""

@StrategyRegistry.register
class CausalStrategy(StrategyBase):
    name = "causal"
    trigger_keywords = ["为什么", "原因", "归因"]
    ...
```

**已实现的 5 种策略**：

| 策略 | 适用问题 | 核心方法 |
|------|----------|----------|
| **因果归因** | "为什么外调品增加了？" | KG BFS 遍历 + 逐节点 SQL 阈值验证 |
| **统计归因** | "哪些因素与销量最相关？" | 多指标 Pearson/Spearman 相关系数 |
| **对比分析** | "本月 vs 上月各区域差异" | 双时间窗 SQL + Delta% 计算 |
| **趋势追踪** | "近 6 个月产量走势" | 时序 SQL + STL 季节分解 |
| **What-if** | "如果产能提升 20%？" | 参数化 SQL 多场景并行 |

策略路由基于 **置信度竞争**：Intent 节点将问题广播给所有已注册策略，选择 `can_handle()` 得分最高者（阈值 0.3）。

### 3.4 Human-in-the-Loop

利用 LangGraph 的 `interrupt()` 机制实现运行时人机协作：

```python
graph = builder.compile(
    checkpointer=MemorySaver(),
    interrupt_before=["sql_gen"]  # SQL 生成前暂停
)
```

执行到断点时，系统通过 SSE 推送 `event: awaiting_approval`，前端展示 SQL 审批卡片。用户可以：
- **批准**：原样执行
- **编辑**：修改 SQL 后继续
- **终止**：放弃当前分析

审批完成后，前端调用 `/chat/resume` 端点，LangGraph 从检查点恢复执行。

### 3.5 知识图谱驱动的语义增强

**因果知识图谱**（Neo4j）是系统推理的"地图"：
- **节点类型**：Metric（度量指标）、Dimension（维度）、Table（数据表）
- **边类型**：`CAUSES`（因果）、`RELATES_TO`（关联）
- **场景入口**：每个业务场景定义入口指标和下钻路径

在 SQL 生成阶段，系统不将全库 Schema 注入 Prompt（会导致 LLM 生成不存在的列名），而是根据 KG 子图 **聚焦到相关表和字段**，显著提升 SQL 准确率。

**Few-shot RAG**（ChromaDB）提供相似问题的 SQL 示例，进一步约束 LLM 的生成空间。

---

## 4. 实时推理可视化

### 4.1 SSE Named Events 协议

系统定义了 10 种命名事件类型，对应推理的不同阶段：

```
event: thinking     → 意图分析中
event: intent       → 意图识别结果 + 策略选择
event: planning     → 子任务分解列表
event: sql_ready    → SQL 已生成（可选：等待审批）
event: executing    → SQL 执行中
event: result       → 查询结果 (columns + rows)
event: reflecting   → 反思评估中
event: chart        → 图表配置 (ECharts option)
event: conclusion   → 最终结论 + 归因路径
event: done         → 推理完成
```

前端收到每个事件后实时更新推理时间线，用户可以 **观察到系统的思考过程**——这是区别于传统 ChatBI "黑箱出答案"的关键体验差异。

### 4.2 自动图表选择

Conclude 节点根据查询结果的结构自动选择可视化类型：

| 数据特征 | 图表类型 |
|----------|----------|
| 时间列 + 数值列 | 折线图 |
| 分类列（≤8 类）+ 数值列 | 饼图 |
| 分类列 + 数值列 | 柱状图 |
| 双数值列 | 散点图 |
| 其他 | 数据表格 |

---

## 5. 实验与验证

### 5.1 数据集

使用某企业供应链管理系统脱敏数据，涵盖销售、库存、生产、物流等业务：

| 指标 | 数值 |
|------|------|
| 数据库 | SQLite |
| 业务表 | 10 张 |
| 数据行数 | 24,520 |
| KG 节点 | 167 |
| KG 边 | 170 |
| 归因场景 | 5 |
| Few-shot SQL | 65 条 |

### 5.2 归因推理示例

**用户问题**："为什么本月外调品增加了？"

**系统推理轨迹**（3 步完成）：

| 步骤 | 层级 | 指标 | 实际值 | 阈值 | 判定 |
|------|------|------|--------|------|------|
| Step 1 | 销售层 | 外调占比 | 64.5% | 严重 > 40% | **异常** → 继续追溯 |
| Step 2 | 库存层 | 告急记录 | 41 条 | 严重 > 30 条 | **异常** → 继续追溯 |
| Step 3 | 生产层 | 完成率 | 88.1% | 正常 > 85% | **正常** → 根因到达 |

**归因结论**：产量不足（生产层）→ 库存告急（库存层）→ 外调品增加（销售层）。建议建立产销协同机制，动态调整生产计划。

### 5.3 系统规模

| 模块 | 代码行数 | 说明 |
|------|----------|------|
| Python 后端 | ~7,100 | FastAPI API + Pipeline 框架 + 推理引擎 + 策略 |
| TypeScript 前端 | ~2,800 | 11 页面 + 6 组件 + 双主题系统 |
| 合计 | ~9,900 | — |

---

## 6. 相关工作对比

| 维度 | Vanna.ai | Dify | DeerFlow | **DataAgent v2** |
|------|----------|------|----------|------------------|
| 核心定位 | Text-to-SQL | 工作流编排 | 通用 SuperAgent | **领域垂直数据归因** |
| 推理深度 | 单轮 | 多步（通用） | 多步（通用） | **多步 + 策略组合** |
| 知识图谱 | 无 | 无 | 无 | **Neo4j 因果 KG** |
| SQL 纠错 | 无 | 无 | 有 | **错误注入重试 (≤3)** |
| 人机协作 | 无 | 表单审批 | 无 | **SQL 级 interrupt()** |
| 推理可视化 | 无 | 日志 | 日志 | **实时 SSE 时间线** |
| 策略扩展 | 不支持 | 手动拖拽 | 子 Agent | **@register 子图** |

---

## 7. 局限与展望

### 当前局限

1. **LLM SQL 生成质量**：在列名相似或 Schema 复杂的场景下，仍存在生成不存在列名的问题
2. **KG 构建依赖人工**：因果关系目前由领域专家定义，自动发现能力有待增强
3. **单一数据库**：POC 阶段仅验证了 SQLite，企业级数据仓库（ClickHouse、Hive）的适配尚未完成

### 后续方向

- **知识自进化**：基于用户反馈（高分问答对）自动扩充 Few-shot 库，基于历史数据自动校准阈值
- **多源适配器**：CSV/Excel 直接上传、REST API 实时拉取、文档表格提取（docling）
- **策略自动组合**：复杂问题可串联多个策略子图（如"先趋势，再归因"）
- **场景模板库**：沉淀供应链、销售分析、用户增长等通用场景模板

---

## 8. 技术栈总览

| 层级 | 技术选型 | 作用 |
|------|----------|------|
| 前端 | React 19 + AntDesign 5 + ECharts | 双主题 UI + 图表 + 推理可视化 |
| API | FastAPI + SSE | 13 路由模块 + 实时流式推送 |
| 推理 | LangGraph + LangChain | 状态机 + 子图 + interrupt + checkpointer |
| 知识 | Neo4j 5.26 + ChromaDB | 因果 KG + Few-shot SQL RAG |
| 数据 | SQLAlchemy | 统一 DB 抽象 (SQLite / PG / MySQL) |
| 部署 | Docker Compose + Caddy | 容器化 + TLS 反代 + Basic Auth |

---

## 参考

1. LangGraph: Building Stateful Multi-Actor Applications with LLMs. LangChain, 2024.
2. Vanna.ai: Open-source RAG framework for Text-to-SQL. Vanna AI, 2024.
3. DeerFlow: A Deep Research Framework. ByteDance, 2025.
4. RAGFlow: Deep Document Understanding RAG Engine. InfiniFlow, 2024.
5. ReAct: Synergizing Reasoning and Acting in Language Models. Yao et al., ICLR 2023.
6. Chain-of-Table: Evolving Tables in the Reasoning Chain. Wang et al., ICLR 2024.
