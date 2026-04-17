# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供项目上下文与指导。

## 项目概述

DataAgent v2 是一个面向供应链数据分析的智能问答系统，能够对结构化业务数据执行**多步因果归因推理**。给定一个自然语言问题（如"本月外部采购为什么增加了？"），系统自动规划归因链路，生成并执行 SQL 查询，将结果与阈值进行比较，沿知识图谱向上游追溯异常直至定位根因。

系统采用**四层架构**设计：

| 层次 | 职责 | 关键技术 |
|------|------|----------|
| 应用层 | 交互式 Web 界面、图表可视化、实时流式推送 | React 19、Ant Design 5、ECharts、SSE |
| 引擎层 | 多步推理编排、意图识别、策略调度 | LangGraph StateGraph、LangChain |
| 知识层 | 因果图谱、语义 Schema 字典、Few-shot SQL 示例 | Neo4j、ChromaDB |
| 数据层 | 多数据库连接、SQL 执行、工作空间隔离 | SQLAlchemy 2、SQLite/PostgreSQL/MySQL |

## 构建与运行命令

```bash
# 后端
pip install -e .                          # 安装依赖
cp .env.example .env                      # 配置 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL
uvicorn backend.main:app --host 0.0.0.0 --port 8001   # 启动服务

# 前端
cd frontend && npm install && npm run build   # 生产构建（由 FastAPI 静态托管）
cd frontend && npm run dev                    # 开发服务器，HMR，端口 :5173

# Docker（Neo4j + 后端）
docker-compose up -d

# 开发工具
pip install -e ".[dev]"   # 安装 pytest、ruff、mypy
pytest                    # 运行测试
ruff check .              # 代码检查
```

环境配置（`.env`）：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`（默认 `kimi-k2.5`）、`BASE_PATH`（默认 `/diagnouze`）、`ACCESS_TOKEN`、`DEFAULT_WORKSPACE`。

## 工作空间模型

每个工作空间是 `workspaces/<name>/` 下的独立目录，拥有各自的数据库、知识文件和流水线状态：

```
workspaces/<name>/
  workspace.yaml          # 元数据、数据库连接串、LLM 配置覆盖、当前报告期
  schema_dict.yaml        # 语义增强后的 Schema（中文别名、业务描述、业务规则）
  knowledge_graph.json    # 知识图谱节点/边/场景（从 Neo4j 构建后持久化）
  few_shots.json          # 手工标注的 Q&A 示例，用于 SQL RAG
  few_shots_auto.json     # 从 KG 指标自动生成的 Q&A 示例
  data.db                 # SQLite 数据库（文件导入时创建）
  pipeline_state.json     # 流水线阶段状态追踪
  stages/                 # 各阶段执行结果的 JSON 文件
  scenarios/              # 场景定义 JSON 文件
  docs/                   # 可选的 RAG 文档
```

`Workspace` 类（`knowledge/workspace.py`）提供对全部工作空间资源的访问——数据库引擎、Schema 字典、因果图谱、Few-shot 示例、场景定义。所有状态基于文件存储，不依赖外部状态数据库。

## 流水线架构

系统包含两类流水线，统一在**可插拔阶段注册表**（`core/stage.py`）下管理：

### 初始化流水线（5 个阶段，每个工作空间运行一次）

这 5 个阶段对应论文第 3 章"知识图谱自动构建"：

1. **connect**（`core/stages/connect.py`）—— 验证数据库连接，支持 CSV/Excel 导入为 SQLite。将 `db_url` 持久化到 `workspace.yaml`。

2. **introspect**（`core/stages/introspect.py`）—— 通过 SQLAlchemy `inspect()` 自动发现表、列、类型。计算各列统计信息（基数、空值率、最小/最大/均值、高频取值）。推断列**角色**（primary_key、measure、dimension、identifier、flag、attribute、time）。通过跨表共享列名 + Jaccard 值重叠相似度推断**外键关系**。返回原始 Schema + 样本行。

3. **enrich**（`core/stages/enrich.py`）—— LLM 驱动的语义增强。对每张表，将列类型 + 统计信息 + 样本行发送给 LLM，生成中文别名、业务描述、行粒度。然后推断业务规则、表关联关系（JOIN 路径）和查询词映射（中文 → SQL 表达式）。写入 `schema_dict.yaml`。状态为 `needs_review`——人工审核后方可继续。

4. **build_kg**（`core/stages/build_kg.py`）—— 从增强后的 Schema 中提取**实体**：指标（数值列）、维度（类别列）、表。LLM 推断**因果边**（哪些指标导致哪些指标异常）、**下钻边**（指标 → 维度），并组织为**业务场景**（3-8 个场景，含入口指标和关键词触发器）。写入 Neo4j（以工作空间命名空间隔离）并持久化为 `knowledge_graph.json`。

5. **train_sql**（`core/stages/train_sql.py`）—— 从 KG 自动生成 Q&A 对：每个指标的简单聚合问题、每个指标-维度对的 GROUP BY 下钻问题。同时将 DDL 语句和业务规则索引到 ChromaDB 中用于 few-shot 检索。写入 `few_shots_auto.json`。

### 运行时流水线（2 个阶段，每次用户提问时运行）

6. **text_to_sql**（`core/stages/text_to_sql.py`）—— 核心的检索增强 SQL 生成方法（论文第 4 章）：
   - 知识图谱引导的 **Schema 聚焦**：将问题关键词与 Neo4j 中的 Scenario/Metric/Dimension 节点匹配，仅返回相关表的 Schema 上下文
   - ChromaDB **Few-shot 检索**：对问题进行向量化，检索最相似的 3 个 Q&A 示例
   - LLM **SQL 生成**，基于 Schema + Few-shot 示例 + 业务规则上下文
   - **执行**查询并通过 LLM **解读**结果

7. **attribution**（`core/stages/attribution.py`）—— 多路径因果归因（论文第 4.5 节）：
   - 从入口指标出发，沿 Neo4j 中 `[:CAUSES]` 边进行 BFS 上游遍历
   - 对路径中每个节点生成 SQL 计算当前值
   - 以偏差乘积对路径评分，按证据强度排序
   - LLM 根据排名靠前的路径生成归因结论

### 阶段注册模式

所有阶段继承 `StageBase`，通过 `@StageRegistry.register` 装饰器注册。`PipelineOrchestrator`（`core/pipeline.py`）负责阶段执行、结果持久化和人工审核检查点。阶段结果保存到 `stages/<name>.json`，流水线状态保存到 `pipeline_state.json`。

## 智能推理引擎

推理引擎（`core/reasoning/`）是一个基于 **LangGraph StateGraph** 的 Plan-Execute-Reflect 循环：

```
intent → plan → sql_gen → execute → reflect → (条件分支) → sql_gen | conclude → END
```

### 状态模式（`core/reasoning/state.py`）

`AgentState` 是一个 TypedDict，追踪以下信息：工作空间、问题、策略、意图、计划步骤、推理步骤（审计轨迹）、SQL 及其结果、重试次数、人机协同状态、结论、图表规格、归因路径、下钻深度。

### 图节点（`core/reasoning/nodes.py`）

- **intent_node** —— 通过关键词匹配（5 组关键词集合）+ LLM 回退将问题分类为：causal（因果）、statistical（统计）、comparative（对比）、trend（趋势）、whatif（假设）或 general（通用）策略
- **plan_node** —— LLM 将问题分解为有序子任务（2-5 步）。可用时引入 KG 上下文
- **sql_gen_node** —— 复用 `TextToSqlStage` 基础设施（KG 检索 → Schema 聚焦 → ChromaDB Few-shot → LLM）。重试时包含前次 SQL 错误信息用于自纠错
- **execute_node** —— 通过工作空间的 SQLAlchemy 引擎执行 SQL。返回列名 + 行数据（上限 200 行）
- **reflect_node** —— LLM 评估结果质量。决策：`conclude`（完成）、`drill`（下一步计划）、`retry`（重新生成 SQL，最多 3 次）
- **conclude_node** —— 综合推理轨迹生成最终回答 + 图表规格。对于因果策略，还会构建归因路径

### 人机协同（HITL）

图谱在编译时设置 `interrupt_before=["sql_gen"]`，允许调用方在执行前检查和编辑生成的 SQL。`resume` 端点（`POST /chat/resume`）更新图谱状态为用户编辑后的 SQL 并继续执行。

### 策略体系（`core/reasoning/strategies/`）

6 种可组合策略，每种策略是一个 `StrategyBase` 子类，拥有独立的 LangGraph 子图：

| 策略 | 触发关键词 | 子图 |
|------|-----------|------|
| causal（因果） | 为什么、原因、归因、根因 | traverse → verify → conclude |
| statistical（统计） | 相关、分布、占比、TOP | （默认流水线） |
| comparative（对比） | 对比、比较、同比、环比 | （默认流水线） |
| trend（趋势） | 趋势、走势、变化、历史 | （默认流水线） |
| whatif（假设） | 如果、假设、模拟、预测 | （默认流水线） |
| general（通用） | （回退） | （默认流水线） |

`StrategyRegistry` 通过对每个策略的 `can_handle()` 评分自动路由。

## 知识层

### Schema 构建器（`knowledge/schema_builder.py`）

将 `schema_dict.yaml` 转换为三种 LLM 可用的文本格式：
- `build_ddl()` —— 带中文注释的 CREATE TABLE 语句（用于 ChromaDB 文档索引）
- `build_schema_context()` —— 紧凑的表+字段描述，用于 SQL 生成提示词
- `build_rules_context()` —— 业务规则 + 查询词映射，用于 SQL 提示词

### SQL RAG 存储（`knowledge/vanna_store.py`）

基于 ChromaDB 的轻量级 SQL Few-shot 检索器。每个工作空间在 `workspaces/.chroma/<name>/` 下拥有独立集合。使用余弦相似度（HNSW 索引）。存储问题→SQL 对及元数据（auto/manual 类型、场景）。按工作空间名称缓存实例。

### 工作空间知识文件

- `schema_dict.yaml` —— 增强后的 Schema，包含表、字段（中文别名、类型、描述）、业务规则、表关联关系、查询词映射
- `knowledge_graph.json` —— 节点（指标、维度、表、场景）、边（因果、下钻）、场景定义
- `few_shots.json` / `few_shots_auto.json` —— SQL 示例 Q&A 对

## 后端 API

FastAPI 应用（`backend/main.py`），包含 10 个路由模块。所有端点以 `BASE_PATH/api`（默认 `/diagnouze/api`）为前缀。

主要端点：

| 端点 | 用途 |
|------|------|
| `POST /workspaces/{ws}/chat/agent` | 启动智能推理（SSE 流式） |
| `POST /workspaces/{ws}/chat/resume` | HITL SQL 审批后恢复执行 |
| `POST /workspaces/{ws}/chat` | 简单问答（非推理模式） |
| `POST /workspaces/{ws}/pipeline/run/{stage}` | 运行流水线阶段 |
| `GET /workspaces/{ws}/graph/echarts` | 知识图谱可视化数据 |
| `POST /explorer/{ws}/query` | 执行只读 SQL |

Agent 端点 SSE 事件类型：`thinking`、`intent`、`planning`、`sql_ready`、`awaiting_approval`、`executing`、`result`、`reflecting`、`conclusion`、`chart`、`error`、`done`。

认证中间件：若设置了 `ACCESS_TOKEN`，所有请求需携带有效令牌（Bearer 头、查询参数或 Cookie）。HTML 页面请求返回登录页；API 请求返回 401 JSON。

## 前端架构

React 19 + TypeScript + Vite 8。主要页面：

- **Chat** —— SSE 流式对话，展示推理过程
- **PipelineSetup** —— 引导式 5 阶段初始化向导，含审核检查点
- **KnowledgeGraph** / **CausalGraph** —— 知识图谱可视化（ECharts 图/DAG）
- **DataExplorer** —— 表浏览器，显示行数
- **AttributionExplorer** —— 因果路径可视化
- **SchemaReview** —— 在 KG 构建前审核增强后的 Schema

通信方式：Axios 客户端（`frontend/src/api/client.ts`）+ SSE 辅助工具。主题：`ThemeContext` 实现 light/dark 双主题，通过 Ant Design `ConfigProvider` 集成 CSS 变量。

## 数据流：端到端查询生命周期

1. 用户通过前端 SSE 连接发起提问
2. `agent.py` 构建初始 `AgentState`，通过 `astream()` 运行 LangGraph
3. `intent_node` 对问题进行策略分类（关键词 + LLM）
4. `plan_node` 将问题分解为子任务
5. `sql_gen_node` 调用 `TextToSqlStage`：
   - `_retrieve_kg_context()` —— Neo4j 关键词匹配 → 相关指标/维度/表
   - `_build_focused_schema()` —— 仅保留 KG 匹配到的表的 Schema 上下文
   - `_get_few_shots()` —— ChromaDB 余弦检索最相似的 3 个示例
   - LLM 基于 Schema + Few-shot + 规则上下文生成 SQL
6. `execute_node` 执行 SQL，返回结果
7. `reflect_node` 评估质量，决定重试/下钻/结束
8. 若需重试或下钻则回到步骤 5（最多重试 3 次，最多下钻 3 层）
9. `conclude_node` 生成最终回答 + 图表规格
10. 因果策略时：通过 Neo4j BFS 构建归因路径
11. SSE 事件将各步骤输出实时推送到前端

## 关键设计决策

- **基于文件的状态管理**：所有流水线状态和工作空间数据以 JSON/YAML 文件存储，无外部状态数据库。追求简洁而非扩展性。
- **Neo4j 工作空间隔离**：所有节点/边以 `workspace` 属性标记。Cypher 查询按工作空间过滤，支持多租户使用。
- **知识图谱引导的 Schema 聚焦**：不将完整数据库 Schema 发送给 LLM，而是通过知识图谱缩小上下文至相关表。减少 token 消耗并提升 SQL 准确率。
- **双层 SQL 生成**：简单查询直接使用 `text_to_sql` 阶段；复杂因果问题使用完整的智能推理引擎，执行多步 Plan-Execute-Reflect 循环。
- **LLM 无关性**：所有 LLM 调用通过 `ChatOpenAI`，可配置 `base_url`、`api_key`、`model`。支持在 `workspace.yaml` 的 `llm` 部分进行工作空间级别的覆盖。
- **JSON 解析容错**：`_parse_json()` 辅助函数自动剥离 Markdown 代码块标记，回退提取第一个 `{...}` 块。所有 LLM 的 JSON 输出均经过此处理。
- **列角色推断**（`introspect.py`）：数值型 + 高基数 → 度量（measure）；文本型 + 低基数 → 维度（dimension）；基于后缀启发式判断标识符。此分类驱动 KG 构建中的实体抽取。
