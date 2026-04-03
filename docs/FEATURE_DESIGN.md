# DataAgent v2 — 功能设计文档（第二阶段）

> 版本: 2.1-draft | 文档日期: 2026-04-03 | 状态: 设计阶段

---

## 0. 研究背景：参考框架调研

在设计第二阶段之前，我们调研了几个同类框架，以避免重复造轮子。

### DeerFlow（ByteDance，2025-2026）

**GitHub**: https://github.com/bytedance/deer-flow

DeerFlow 是 ByteDance 开源的 SuperAgent 框架，v1.0（2025年5月）定位为深度研究自动化框架，v2.0（2026年2月）重写为通用 agentic 编排平台。

**核心架构**:
- 基于 LangGraph 1.0 + LangChain 构建，LangGraph 负责图状态机
- Lead Agent 可动态 spawn Sub-agents，各自持有独立 context 和工具集
- 内置 Memory 层（长期 + 上下文）、Sandbox（local / Docker / K8s）、Skill 注册表
- Message Gateway 集成 Slack / Telegram / Feishu

**与 LangGraph 的关系**:
| 层面 | 原生 LangGraph | DeerFlow |
|------|--------------|---------|
| 内存 | 仅 State | 长期 + 上下文多层内存 |
| 沙箱 | 无 | local / Docker / K8s |
| 子智能体 | 需手写 sub-graph | 框架原生支持动态 spawn |
| 观测 | 基础 | LangSmith + Langfuse 开箱即用 |
| 适用场景 | 精确状态控制 | 长时任务（分钟到小时级别）|

**DataAgent 的结论**: DeerFlow 的 Sub-agent spawn 和 Sandbox 适合通用研究任务，对于 DataAgent 这类**领域垂直、推理路径可控**的场景，直接使用原生 LangGraph sub-graph 更合适——可精确控制状态转移、SQL 重试逻辑和归因路径，无需引入额外的抽象层。

### RAGFlow（InfiniFlow，2024-2025）

RAGFlow 是以**文档解析 + RAG** 为核心的智能体平台，v0.8 后进入 Agentic 时代，提供 no-code 工作流编辑器。其深度文档解析能力（PDF / DOCX / Excel / PPT）对 DataAgent 的**文档数据源接入**有参考价值——可使用 `docling` 库实现类似的文档解析管道。

### Agno（原 phidata，2025）

Agno 是轻量级多模态 Agent 框架，声称比 LangGraph 实例化快 5000x。其 Auto-RAG 范式（Agent 自主决定何时搜索知识库）可以启发 DataAgent 的 **SQL RAG 检索时机**设计。但 Agno 缺少状态机式的推理循环，不适合替代 LangGraph。

---

## 1. 设计目标

从"数据查询工具"进化为"智能数据分析代理"：

| 维度 | 当前（阶段一） | 目标（阶段二） |
|------|--------------|--------------|
| **推理模式** | 一次性生成 SQL | Plan-Execute-Reflect 循环，支持多步骤分解 |
| **错误处理** | SQL 报错则失败 | 自动自修正，最多 N 次重试 |
| **推理策略** | 固定路径（text2sql / attribution 二选一）| 动态策略组合（因果 / 统计 / 对比 / 趋势）|
| **人机协作** | 仅 Setup 阶段支持人工审核 | Runtime 推理中支持 SQL 审批和方向修正 |
| **数据源** | SQL 数据库为主 | SQL + CSV/Excel + REST API + 文档（docling）|
| **知识进化** | 静态 few-shot 库 | 用户反馈驱动的自动扩展 |
| **前端体验** | 文字 + 表格结果 | 实时推理可视化 + 交互式归因 DAG |

---

## 2. 技术架构（分层）

```
┌─────────────────────── 展示层 (Presentation Layer) ────────────────────────┐
│  实时推理流展示（SSE named events）  归因路径交互式 DAG  策略选择器           │
│  内联 SQL 编辑器（approve/reject）   自动图表选择器                         │
└─────────────────────────────┬──────────────────────────────────────────────┘
                              │ SSE + REST
┌─────────────────────────────▼──────────────────────────────────────────────┐
│                   推理引擎层 (Reasoning Engine Layer)                        │
│                                                                              │
│  LangGraph 状态机                                                            │
│  ┌──────────┐  ┌──────┐  ┌────────┐  ┌─────────┐  ┌─────────┐            │
│  │  intent  │→ │ plan │→ │sql_gen │→ │ execute │→ │ reflect │            │
│  └──────────┘  └──────┘  └────────┘  └─────────┘  └────┬────┘            │
│                                          ↑               │                  │
│                                          └── retry / drill / conclude ──┘   │
│                                                                              │
│  Strategy Sub-graphs: causal | statistical | comparative | trend | whatif   │
│  interrupt() + MemorySaver Checkpointer (Human-in-the-Loop)                 │
└─────────────────────────────┬──────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────────────────────┐
│                   知识层 (Knowledge Layer)                                   │
│  Neo4j KG: 因果关系 + 场景入口 + 下钻路径 + 动态进化                        │
│  ChromaDB: Few-shot SQL + 业务规则文档 + 用户反馈扩展                        │
└─────────────────────────────┬──────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────────────────────┐
│                   数据层 (Data Layer)                                        │
│  SQLAlchemy: 统一 DB 抽象（SQLite / PG / MySQL）                             │
│  Vanna.ai / 自研: Text-to-SQL RAG（ChromaDB 实现）                          │
│  DataSourceAdapter 插件: CSV/Excel + REST API + Document (docling)          │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心模块设计

### 3.1 Agentic 推理循环（Plan-Execute-Reflect）

#### 3.1.1 AgentState 设计

```python
from typing import Annotated, Literal
from langgraph.graph import MessagesState
from pydantic import BaseModel

class ReasoningStep(BaseModel):
    step_type: Literal["plan", "sql_gen", "execute", "reflect", "conclude"]
    content: str
    sql: str | None = None
    result: dict | None = None   # {columns, rows}
    error: str | None = None
    timestamp: str

class AgentState(MessagesState):
    # 基本上下文
    workspace: str
    question: str
    strategy: str                          # "causal" | "statistical" | "comparative" | "trend" | "auto"

    # 推理过程
    intent: str                            # LLM 解析后的意图摘要
    plan: list[str]                        # 分解的子任务列表
    current_step_index: int                # 当前执行到第几步
    reasoning_steps: list[ReasoningStep]   # 完整推理历史

    # SQL 执行状态
    current_sql: str | None
    sql_result: dict | None                # {columns, rows}
    sql_error: str | None
    retry_count: int                       # SQL 重试次数
    max_retries: int                       # 最大重试次数（默认 3）

    # 人机交互
    pending_approval: bool                 # 是否等待用户审批 SQL
    user_edited_sql: str | None           # 用户修改后的 SQL

    # 最终输出
    conclusion: str | None
    attribution_paths: list[dict]          # 归因路径（可选）
    chart_spec: dict | None               # 图表配置（ECharts spec）
    drill_depth: int                       # 当前下钻深度
    max_drill_depth: int                   # 最大下钻深度（默认 3）
```

#### 3.1.2 LangGraph 节点定义

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

def intent_node(state: AgentState) -> AgentState:
    """解析用户意图，路由到策略"""
    # 关键词匹配 + LLM 分类
    # 输出: state.intent, state.strategy

def plan_node(state: AgentState) -> AgentState:
    """将问题分解为可执行子任务列表"""
    # 输出: state.plan (list[str])

def sql_gen_node(state: AgentState) -> AgentState:
    """基于 ChromaDB RAG + KG schema 生成 SQL"""
    # 若 pending_approval=True，等待用户确认后才执行
    # 若 user_edited_sql 不为空，使用用户版本

def execute_node(state: AgentState) -> AgentState:
    """执行 SQL，捕获错误"""
    # 输出: state.sql_result 或 state.sql_error

def reflect_node(state: AgentState) -> AgentState:
    """评估结果质量，决定下一步动作"""
    # 判断: 结果是否合理、是否需要重试、是否需要下钻、是否可以结论

def conclude_node(state: AgentState) -> AgentState:
    """综合所有步骤，生成最终解读 + 图表配置"""

# 条件边路由
def route_after_reflect(state: AgentState) -> str:
    if state.sql_error and state.retry_count < state.max_retries:
        return "sql_gen"          # SQL 错误 → 重试
    if state.drill_depth < state.max_drill_depth:
        strategy_graph = state.strategy
        return f"strategy_{strategy_graph}"  # 进入策略子图
    return "conclude"             # 达到深度上限 → 结论

# 图定义
def build_agent_graph() -> StateGraph:
    builder = StateGraph(AgentState)
    builder.add_node("intent", intent_node)
    builder.add_node("plan", plan_node)
    builder.add_node("sql_gen", sql_gen_node)
    builder.add_node("execute", execute_node)
    builder.add_node("reflect", reflect_node)
    builder.add_node("conclude", conclude_node)

    builder.set_entry_point("intent")
    builder.add_edge("intent", "plan")
    builder.add_edge("plan", "sql_gen")
    builder.add_edge("sql_gen", "execute")
    builder.add_edge("execute", "reflect")
    builder.add_conditional_edges("reflect", route_after_reflect)
    builder.add_edge("conclude", END)

    checkpointer = MemorySaver()
    return builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["sql_gen"]   # Human-in-the-Loop 断点
    )
```

#### 3.1.3 SQL 错误自修正机制

`sql_gen_node` 在重试时需要将上次错误注入 prompt：

```python
RETRY_PROMPT = """
上次生成的 SQL 执行失败：
错误信息: {error}
失败的 SQL:
{failed_sql}

请分析错误原因并生成修正后的 SQL。常见错误及修正策略：
- "no such column" → 检查列名是否在 schema 中，可能需要使用别名
- "ambiguous column" → 添加表名前缀（table.column）
- "no such table" → 检查表名拼写，参考 DDL
- syntax error → 检查 SQL 语法，特别是引号和括号
"""
```

---

### 3.2 可组合推理策略（Strategy Sub-graphs）

#### 3.2.1 策略注册表

```python
from abc import ABC, abstractmethod
from typing import ClassVar

class StrategyBase(ABC):
    name: ClassVar[str]
    display_name: ClassVar[str]
    trigger_keywords: ClassVar[list[str]]   # 意图检测关键词

    @abstractmethod
    def build_subgraph(self) -> StateGraph:
        """返回该策略的 LangGraph sub-graph"""

    @abstractmethod
    def can_handle(self, intent: str, question: str) -> float:
        """返回 0-1 的置信度，用于策略路由"""

class StrategyRegistry:
    _strategies: dict[str, StrategyBase] = {}

    @classmethod
    def register(cls, strategy_cls: type[StrategyBase]):
        instance = strategy_cls()
        cls._strategies[instance.name] = instance
        return strategy_cls

    @classmethod
    def route(cls, intent: str, question: str) -> str:
        """根据意图和问题内容，返回最匹配的策略名称"""
        scores = {
            name: s.can_handle(intent, question)
            for name, s in cls._strategies.items()
        }
        return max(scores, key=scores.get)
```

#### 3.2.2 五大推理策略

| 策略 | 触发关键词 | 核心逻辑 |
|------|----------|---------|
| **因果归因** (causal) | 为什么、原因、归因、怎么了 | KG 遍历 + 阈值对比 SQL，沿因果边逐级溯源 |
| **统计归因** (statistical) | 相关性、影响、驱动、关联 | 多指标相关系数计算，statsmodels 线性回归 |
| **对比分析** (comparative) | 对比、环比、同比、差异、vs | 时间窗口 / 维度切片对比 SQL |
| **趋势追踪** (trend) | 趋势、变化、走势、增长、下滑 | 时序分解（seasonal_decompose）+ 异常点检测 |
| **What-if 模拟** (whatif) | 如果、假设、预测、模拟 | 参数化 SQL 模板，多场景并行执行 |

#### 3.2.3 因果归因子图（示例）

```python
@StrategyRegistry.register
class CausalStrategy(StrategyBase):
    name = "causal"
    display_name = "因果归因"
    trigger_keywords = ["为什么", "原因", "归因", "怎么了", "导致"]

    def build_subgraph(self) -> StateGraph:
        builder = StateGraph(AgentState)
        builder.add_node("find_entry_metric", self._find_entry_metric)
        builder.add_node("traverse_kg", self._traverse_kg)
        builder.add_node("verify_each_node", self._verify_each_node)  # SQL 验证
        builder.add_node("rank_paths", self._rank_paths)
        # ... edges
        return builder.compile()

    def _traverse_kg(self, state: AgentState) -> AgentState:
        """沿 KG 因果边 BFS，限制深度为 max_drill_depth"""
        # Neo4j Cypher: MATCH path = (m)-[:CAUSES*1..3]->(root)
        # WHERE root.id = $entry_metric
        # RETURN path

    def can_handle(self, intent: str, question: str) -> float:
        keyword_score = sum(
            1 for kw in self.trigger_keywords if kw in question
        ) / len(self.trigger_keywords)
        return min(keyword_score * 2, 1.0)
```

---

### 3.3 多源数据适配器

#### 3.3.1 适配器基类

```python
from abc import ABC, abstractmethod
import pandas as pd
from sqlalchemy import Engine

class DataSourceAdapter(ABC):
    """所有数据源适配器的基类，统一输出为 SQLite 可查询的 DataFrame"""

    adapter_type: ClassVar[str]   # "sql" | "csv" | "excel" | "rest" | "document"

    @abstractmethod
    def connect(self, config: dict) -> bool:
        """验证连接，返回是否成功"""

    @abstractmethod
    def fetch(self, config: dict) -> dict[str, pd.DataFrame]:
        """拉取数据，返回 {table_name: DataFrame}"""

    def materialize(self, engine: Engine, config: dict) -> list[str]:
        """将数据写入 SQLite 临时表，返回表名列表"""
        frames = self.fetch(config)
        table_names = []
        for table_name, df in frames.items():
            df.to_sql(table_name, engine, if_exists="replace", index=False)
            table_names.append(table_name)
        return table_names
```

#### 3.3.2 各适配器实现

```python
class SQLAdapter(DataSourceAdapter):
    adapter_type = "sql"
    # 已有实现，通过 SQLAlchemy 连接 SQLite/PG/MySQL

class CSVExcelAdapter(DataSourceAdapter):
    adapter_type = "csv"

    def fetch(self, config: dict) -> dict[str, pd.DataFrame]:
        path = config["file_path"]
        if path.endswith(".csv"):
            return {config.get("table_name", "data"): pd.read_csv(path)}
        else:  # Excel，每个 sheet 成为一张表
            xls = pd.ExcelFile(path)
            return {sheet: xls.parse(sheet) for sheet in xls.sheet_names}

class RestAPIAdapter(DataSourceAdapter):
    adapter_type = "rest"

    def fetch(self, config: dict) -> dict[str, pd.DataFrame]:
        import httpx
        resp = httpx.get(config["url"], headers=config.get("headers", {}))
        data = resp.json()
        # 支持 {data: [...]} 或 [...] 格式
        rows = data.get("data", data) if isinstance(data, dict) else data
        return {config.get("table_name", "api_data"): pd.DataFrame(rows)}

class DocumentAdapter(DataSourceAdapter):
    """使用 docling 解析 PDF/DOCX，提取表格数据"""
    adapter_type = "document"

    def fetch(self, config: dict) -> dict[str, pd.DataFrame]:
        from docling.document_converter import DocumentConverter
        converter = DocumentConverter()
        result = converter.convert(config["file_path"])
        tables = {}
        for i, table in enumerate(result.document.tables):
            df = table.export_to_dataframe()
            tables[f"doc_table_{i}"] = df
        return tables
```

#### 3.3.3 workspace.yaml 配置扩展

```yaml
# workspace.yaml 新增 data_sources 配置块
name: my-workspace
data_sources:
  - type: sql
    url: "sqlite:///./data/main.db"
    primary: true
  - type: csv
    file_path: "./data/budget.csv"
    table_name: budget_plan
  - type: rest
    url: "https://api.example.com/sales"
    headers:
      Authorization: "Bearer ${API_TOKEN}"
    table_name: realtime_sales
    refresh_interval: 3600   # 秒，0 表示不刷新
  - type: document
    file_path: "./docs/annual_report.pdf"
    table_name: report_tables
```

---

### 3.4 人机协作（Human-in-the-Loop）

#### 3.4.1 LangGraph interrupt() 机制

```python
# 在 build_agent_graph() 中配置断点
graph = builder.compile(
    checkpointer=MemorySaver(),
    interrupt_before=["sql_gen"]   # 每次生成 SQL 前暂停
)

# 后端 chat 接口：流式执行到断点
async def stream_with_interrupt(question: str, thread_id: str):
    config = {"configurable": {"thread_id": thread_id}}
    async for event in graph.astream_events(
        {"question": question}, config=config, version="v2"
    ):
        yield format_sse_event(event)
        if event["event"] == "on_chain_end" and graph.get_state(config).next:
            # 到达 interrupt 点，通知前端等待审批
            yield format_sse_event({"type": "pending_approval",
                                    "sql": graph.get_state(config).values["current_sql"]})
            break

# /chat/resume 接口：用户审批后继续
async def resume_after_approval(thread_id: str, approved_sql: str | None):
    config = {"configurable": {"thread_id": thread_id}}
    # 更新 state 中的 SQL（用户可能修改过）
    graph.update_state(config, {
        "pending_approval": False,
        "user_edited_sql": approved_sql
    })
    # 继续执行
    async for event in graph.astream_events(None, config=config, version="v2"):
        yield format_sse_event(event)
```

#### 3.4.2 前端交互设计

SQL 审批 UI 组件（`SqlApprovalCard.tsx`）：

```
┌─────────────────────────────────────────────┐
│  [等待审批] 即将执行以下 SQL                   │
│                                              │
│  SELECT SUM(deliv_qty_mt) AS total,          │
│    brnch_descrptn AS branch               │
│  FROM sales_delivery                         │
│  GROUP BY brnch_descrptn                     │
│  ORDER BY total DESC                         │
│                                              │
│  [编辑 SQL]                                  │
│  [✓ 批准执行]    [✗ 终止分析]                 │
└─────────────────────────────────────────────┘
```

- 用户可直接在代码框内修改 SQL
- 点击"批准执行"后，前端调用 `POST /api/workspaces/{ws}/chat/resume`
- 前端继续订阅 SSE，展示后续推理步骤

---

### 3.5 动态知识进化

#### 3.5.1 查询反馈 → Few-shot 自动扩展

```python
class FeedbackProcessor:
    """处理用户评分，高分问答对自动进入 few-shot 库"""

    HIGH_SCORE_THRESHOLD = 4   # 4-5 星触发自动扩展

    async def process_feedback(self, workspace: str, log_id: str, score: int):
        if score < self.HIGH_SCORE_THRESHOLD:
            return

        log = await QueryLog.get(log_id)
        # 写入 ChromaDB few-shot 库
        await sql_rag_store.add_question_sql(
            question=log.question,
            sql=log.sql,
            source="user_feedback",
            score=score
        )
        # 更新 few_shots.json 持久化
        await self._persist_to_few_shots_json(workspace, log)
```

#### 3.5.2 异常检测 → KG 新因果边建议

```python
class AnomalyKGEvolver:
    """当检测到新的异常模式时，建议添加 KG 因果边"""

    async def suggest_new_edges(self, workspace: str, anomaly_report: dict):
        """
        输入: 归因分析发现了某个未在 KG 中记录的因果关系
        输出: 建议的新 KG 边，发送给人工审核
        """
        prompt = f"""
        系统发现了一个新的因果关系：
        {anomaly_report['finding']}

        当前 KG 中没有记录这条边。请确认是否应该添加：
        FROM: {anomaly_report['source_metric']}
        TO: {anomaly_report['target_metric']}
        TYPE: causal
        CONFIDENCE: {anomaly_report['confidence']}
        """
        # 创建待人工审核的 KG 编辑建议
        await KGEditProposal.create(workspace=workspace, prompt=prompt, data=anomaly_report)
```

#### 3.5.3 阈值自动校准

```python
class ThresholdCalibrator:
    """基于历史查询结果，自动校准指标阈值"""

    async def calibrate(self, workspace: str, metric_id: str):
        # 查询最近 90 天的指标值
        historical_values = await self._fetch_historical(workspace, metric_id)
        p10 = np.percentile(historical_values, 10)
        p25 = np.percentile(historical_values, 25)

        # 更新 Neo4j 中的 threshold 属性
        await neo4j_store.update_metric_threshold(
            metric_id=metric_id,
            warn_threshold=p25,
            alert_threshold=p10
        )
```

---

### 3.6 前端智能展示

#### 3.6.1 SSE 事件流协议（Named Events）

后端 SSE 输出从纯文本升级为结构化命名事件：

```
event: thinking
data: {"step": "intent", "content": "正在分析问题意图..."}

event: planning
data: {"steps": ["查询整体达成率", "按分公司下钻", "找出异常分公司", "溯源原因"]}

event: sql_ready
data: {"sql": "SELECT ...", "pending_approval": true}

event: executing
data: {"sql": "SELECT ...", "status": "running"}

event: result
data: {"columns": [...], "rows": [...], "row_count": 42}

event: reflecting
data: {"content": "发现华南区达成率仅62%，显著低于均值，进入归因..."}

event: attribution_step
data: {"depth": 1, "metric": "华南区订单缺口", "value": -320, "threshold": 0}

event: chart
data: {"type": "bar", "title": "各分公司达成率", "option": {...}}

event: conclusion
data: {"content": "综合分析：华南区达成率偏低主因是..."}

event: done
data: {}
```

#### 3.6.2 推理过程实时可视化

`ReasoningTimeline.tsx` 组件：

```
  [意图] → [规划] → [SQL生成] → [执行] → [反思] → [下钻] → [结论]
    ✓         ✓        ⟳审批中      ○         ○        ○        ○

  当前步骤详情:
  ┌──────────────────────────────────┐
  │ 生成 SQL — 按分公司查询达成率      │
  │ SELECT branch, SUM(actual)/...   │
  │ [批准执行]  [修改后执行]  [终止]   │
  └──────────────────────────────────┘
```

#### 3.6.3 归因路径交互式 DAG

在现有 ECharts DAG 基础上，`AttributionPathGraph.tsx` 新增：
- 节点颜色编码：绿（正常）/ 黄（警告）/ 红（异常）
- 边权重：偏差幅度 → 边的粗细
- 点击节点：展开该指标的实际 SQL + 数值
- 右键节点：手动标记为"根因"，写入 KG 反馈

#### 3.6.4 自动图表选择

```python
class ChartAutoSelector:
    """根据结果数据特征，自动选择最佳图表类型"""

    def select(self, columns: list[str], rows: list[dict],
               question: str) -> dict:
        col_types = self._infer_types(columns, rows)
        row_count = len(rows)

        if col_types["time"] and col_types["numeric"]:
            return self._line_chart(columns, rows)      # 时序 → 折线
        elif col_types["categorical"] and row_count <= 8:
            return self._pie_chart(columns, rows)       # 少类别 → 饼图
        elif col_types["categorical"] and col_types["numeric"]:
            return self._bar_chart(columns, rows)       # 分类 + 数值 → 柱状
        elif col_types["two_numeric"]:
            return self._scatter_chart(columns, rows)   # 两数值 → 散点
        else:
            return {"type": "table"}                    # 降级为表格
```

---

## 4. API 设计

### 4.1 新增 / 增强接口

| 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|
| POST | `/api/workspaces/{ws}/chat` | **增强**: SSE Named Events + strategy 参数 | 改造 |
| POST | `/api/workspaces/{ws}/chat/resume` | **新增**: interrupt 恢复，含用户编辑的 SQL | 新增 |
| GET | `/api/workspaces/{ws}/chat/state` | **新增**: 获取当前推理状态（用于页面刷新恢复）| 新增 |
| POST | `/api/workspaces/{ws}/upload` | **新增**: 多源数据导入（CSV/Excel/REST/文档）| 新增 |
| GET | `/api/workspaces/{ws}/strategies` | **新增**: 列出可用推理策略及当前推荐 | 新增 |
| POST | `/api/workspaces/{ws}/kg/propose` | **新增**: 提交 KG 边编辑建议 | 新增 |
| GET | `/api/workspaces/{ws}/kg/proposals` | **新增**: 获取待审核的 KG 编辑建议 | 新增 |
| PUT | `/api/workspaces/{ws}/kg/proposals/{id}` | **新增**: 审批 / 拒绝 KG 编辑建议 | 新增 |

### 4.2 Chat 接口增强

**POST** `/api/workspaces/{ws}/chat`

Request Body（增强字段）:
```json
{
  "question": "为什么华南区本月销量达成率偏低？",
  "strategy": "auto",           // "auto" | "causal" | "statistical" | "comparative" | "trend"
  "require_approval": true,     // 是否要求 SQL 审批（默认 true）
  "max_retries": 3,             // SQL 最大重试次数
  "max_drill_depth": 3,         // 最大下钻深度
  "thread_id": "uuid-xxx"       // 可选，指定对话线程 ID（用于多轮）
}
```

SSE Response（Named Events，见 3.6.1）

**POST** `/api/workspaces/{ws}/chat/resume`

Request Body:
```json
{
  "thread_id": "uuid-xxx",
  "action": "approve",          // "approve" | "reject" | "edit"
  "edited_sql": "SELECT ..."    // action=edit 时必填
}
```

### 4.3 数据上传接口

**POST** `/api/workspaces/{ws}/upload`

```json
{
  "source_type": "csv",         // "csv" | "excel" | "rest" | "document"
  "file_path": "...",           // 服务端路径（文件先通过 multipart 上传）
  "table_name": "budget_plan",
  "refresh_interval": 0
}
```

---

## 5. 实现路线图

### Phase 2a：Agentic 推理核心（第 1-2 周）

**目标**: 用 LangGraph Plan-Execute-Reflect 替换现有的单轮 text_to_sql

- [ ] `AgentState` 设计 + `build_agent_graph()` 实现
- [ ] `intent_node` / `plan_node` / `sql_gen_node` / `execute_node` / `reflect_node` / `conclude_node`
- [ ] SQL 错误自修正：retry prompt 注入，最多 3 次
- [ ] SSE Named Events 协议：后端 `format_sse_event()` 工具函数
- [ ] 前端 `ReasoningTimeline.tsx`：订阅 Named Events，实时展示推理步骤
- [ ] 兼容旧接口：在 `/api/workspaces/{ws}/chat` 上直接替换底层逻辑

**验收标准**: supply-chain workspace 上，归因类问题能自动完成 2+ 轮 SQL 重试并给出结论。

### Phase 2b：人机协作 + 策略组合（第 3-4 周）

**目标**: SQL 审批 + 5 大策略子图 + 意图路由

- [ ] `MemorySaver` Checkpointer 集成，`interrupt_before=["sql_gen"]`
- [ ] `POST /api/workspaces/{ws}/chat/resume` 接口
- [ ] 前端 `SqlApprovalCard.tsx`：内联 SQL 编辑器 + 审批按钮
- [ ] `StrategyRegistry` + `StrategyBase` 基类
- [ ] `CausalStrategy` sub-graph（扩展现有 attribution）
- [ ] `ComparativeStrategy` sub-graph（环比/同比）
- [ ] `TrendStrategy` sub-graph（时序分解）
- [ ] `intent_node` 中接入 `StrategyRegistry.route()`

**验收标准**: 用户可修改 SQL 后继续分析；"对比分析"类问题路由到 ComparativeStrategy。

### Phase 2c：多源适配 + 知识进化（第 5 周）

**目标**: 支持 CSV/文档导入，反馈驱动的 few-shot 扩展

- [ ] `DataSourceAdapter` 基类 + `CSVExcelAdapter` / `DocumentAdapter` 实现
- [ ] `docling` 集成（PDF 表格提取）
- [ ] `POST /api/workspaces/{ws}/upload` 接口
- [ ] `FeedbackProcessor`：高分评价 → ChromaDB few-shot 自动写入
- [ ] `ThresholdCalibrator`：基于历史数据校准指标阈值
- [ ] `workspace.yaml` 多数据源配置块支持

**验收标准**: 上传 Excel 文件后，可在聊天中直接查询其中数据。

### Phase 2d：前端体验升级（第 6 周）

**目标**: 归因 DAG + 自动图表 + 策略选择器

- [ ] `AttributionPathGraph.tsx`：交互式归因 DAG（颜色编码 + 节点展开）
- [ ] `ChartAutoSelector`：根据数据特征自动选择 ECharts 图表类型
- [ ] 策略选择器 UI：对话框顶部显示当前策略，支持手动切换
- [ ] `CausalGraph.tsx` 全功能实现（占位页转完整实现）
- [ ] React Code Splitting：按路由 `React.lazy()`，减少首屏 bundle

**验收标准**: 时序数据自动显示折线图；归因路径以交互式 DAG 呈现，可点击节点查看 SQL 证据。

---

## 6. 依赖与风险

### 6.1 新增依赖

| 包 | 用途 | 版本建议 |
|----|------|---------|
| `langgraph` | 核心推理状态机 | >=0.2.0 |
| `langgraph-checkpoint` | MemorySaver checkpointer | 与 langgraph 同版本 |
| `docling` | PDF/DOCX 表格提取 | >=1.0 |
| `statsmodels` | 统计归因、时序分解 | >=0.14 |
| `httpx` | REST API 数据源适配器 | >=0.27 |
| `numpy` | 阈值校准计算 | >=1.26（通常已有） |

### 6.2 风险识别与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| **LLM 意图识别不准** | 策略路由错误，用户体验差 | 在前端显示当前策略，允许手动切换 |
| **LLM 生成 SQL 质量不稳定** | 重试耗时长，结论错误 | SQL 语法预检（sqlparse）+ 最多 3 次重试 + 用户可接管 |
| **Neo4j 查询性能** | 深层 KG 遍历慢（>3s） | 限制 BFS 深度为 3，添加 Cypher 查询超时 |
| **MemorySaver 内存增长** | 长对话占用内存 | 对话超过 20 轮后清除旧 checkpoint |
| **docling 解析失败** | 无法读取复杂 PDF | 降级为文本提取（pdfplumber），并提示用户 |
| **SSE 连接断开** | 用户刷新页面丢失推理状态 | `thread_id` 持久化到 localStorage，刷新后通过 `/chat/state` 恢复 |
| **并发推理冲突** | 同一 workspace 多用户同时提问 | 每次会话分配独立 `thread_id`，State 互不干扰 |

### 6.3 不引入 DeerFlow 的决策说明

DeerFlow 2.0 提供的 Sub-agent spawn、长期 Memory、Sandbox 等能力，对 DataAgent 的**垂直数据分析场景**是过度设计：

1. DataAgent 的推理深度有限（最多 3-4 步），不需要 DeerFlow 的分钟到小时级任务编排
2. DeerFlow 抽象层使精确控制 SQL 重试和归因路径变得困难
3. 原生 LangGraph sub-graph 已能满足策略组合需求，且无额外依赖
4. 如未来需要长时间后台任务（如夜间批量归因），可按需引入 DeerFlow 的 Sub-agent 模式

---

## 7. 状态机流转总图

```
用户提问
    │
    ▼
[intent_node] ──→ 识别意图 + 路由策略
    │
    ▼
[plan_node] ──→ 分解子任务 [task1, task2, ...]
    │
    ▼
[sql_gen_node] ←─────────────────────────────┐
    │  ← interrupt(): 等待用户审批             │
    ▼                                         │ SQL 错误
[execute_node] ──→ 执行 SQL                  │ retry_count < max_retries
    │                                         │
    ▼                                         │
[reflect_node] ──────────────────────────────┘
    │
    ├── SQL 错误 + 未超重试限制 ──→ [sql_gen_node]（重试）
    │
    ├── 结果质量差 + 未超下钻深度 ──→ [strategy_subgraph]（下钻）
    │     └── CausalStrategy / ComparativeStrategy / TrendStrategy
    │
    └── 满意 或 已到限制 ──→ [conclude_node] ──→ 输出结论 + 图表
```

---

*文档由 Claude Code 自动生成，基于代码库实际状态 + DeerFlow / RAGFlow / Agno 框架调研。如有变更请同步更新本文档。*
