# DataAgent v2 — 系统设计文档

> 版本: 2.0-draft | 日期: 2026-04-03

---

## 1. 系统定位

**一句话**: 可插拔的数据智能体平台——指定数据源后，自动完成 Schema 理解 → 语义治理 → 知识图谱构建 → Text-to-SQL → 多路归因分析的全链路。

**核心原则**:
- **模块热插拔**: 每个环节是独立 Stage，可替换、跳过、重跑
- **人机协同**: 关键环节（语义标注、KG审核）暂停等人工审核后再继续
- **配置驱动**: 接入新场景只需配置，不改代码
- **渐进式**: 每个 Stage 产出可独立使用，不必跑完全链路

---

## 2. 系统架构总览

```
┌─────────────────── 前端交互层 ───────────────────┐
│  WorkspaceCreate  PipelineSetup  SchemaReview     │
│  KnowledgeGraph   Chat           DataExplorer     │
└──────────────────────┬───────────────────────────┘
                       │ REST + SSE
┌──────────────────────▼───────────────────────────┐
│              Backend API (FastAPI)                 │
│  /api/pipeline/*   /api/chat   /api/explorer/*    │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│           Pipeline Orchestrator                    │
│  ┌─────┐ ┌──────┐ ┌──────┐ ┌────┐ ┌─────┐       │
│  │conn.│→│intro.│→│enrich│→│ KG │→│train│  Setup │
│  └─────┘ └──────┘ └──────┘ └────┘ └─────┘       │
│  ┌─────────┐ ┌─────────────┐                      │
│  │text2sql │ │ attribution │           Runtime    │
│  └─────────┘ └─────────────┘                      │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│             Knowledge Layer                        │
│  Workspace / Schema / KG Store / SQL RAG          │
└──────────────────────┬───────────────────────────┘
                       │
              ┌────────▼────────┐
              │   Data Sources   │
              │ SQLite/PG/MySQL  │
              └─────────────────┘
```

---

## 3. Pipeline Stage 设计

### 3.1 Stage 基类

每个 Stage 实现统一接口：

```python
class StageBase(ABC):
    name: str                           # "connect", "introspect", ...
    display_name: str                   # "数据源连接"
    description: str                    # 一句话说明
    pipeline_type: "setup" | "runtime"  # 属于哪条流水线
    order: int                          # 执行顺序
    
    def run(workspace, input, config) → StageResult
    def validate_input(workspace, input) → list[str]
    def get_default_config() → dict
```

```python
class StageResult:
    status: "success" | "failed" | "needs_review"
    data: dict              # 结构化输出
    artifacts: list[str]    # 写入的文件路径
    message: str            # 人类可读摘要
    errors: list[str]       # 错误信息
```

`needs_review` 状态使前端暂停展示编辑界面，用户修改确认后再执行下一步。

### 3.2 Setup Pipeline（5个 Stage，每个 workspace 执行一次）

| # | Stage | 输入 | 输出 | 状态 |
|---|-------|------|------|------|
| 1 | **connect** | DB URL / 文件 | 验证通过的连接信息 | 自动 |
| 2 | **introspect** | 数据库连接 | 原始 schema + 列统计 | 自动 |
| 3 | **enrich** | 原始 schema | 语义标注的 schema_dict.yaml | **需人工审核** |
| 4 | **build_kg** | schema_dict + 业务规则 | 知识图谱 (nodes + edges + scenarios) | **需人工审核** |
| 5 | **train_sql** | KG + schema + few_shots | 训练好的 SQL RAG | 自动 |

### 3.3 Runtime Pipeline（2个 Stage，每次用户提问执行）

| # | Stage | 输入 | 输出 |
|---|-------|------|------|
| 6 | **text_to_sql** | 用户问题 + KG + schema | SQL + 执行结果 + 解读 |
| 7 | **attribution** | 异常指标 + KG | 多条归因路径 + 证据排序 |

运行时自动路由：普通查询 → Stage 6；归因类问题 → Stage 6 + Stage 7。

---

## 4. 各 Stage 详细设计

### Stage 1: connect — 数据源连接

**功能**:
- 接收 DB URL（支持 SQLite / PostgreSQL / MySQL）或文件上传（CSV/Excel → 自动建 SQLite）
- 测试连接，获取数据库基本信息（表数量、总行数）
- 写入 `workspace.yaml`

**输出**: `{db_url, db_type, table_count, total_rows, connected: true}`

**技术方案**:
| 组件 | 方案 | 来源 |
|------|------|------|
| DB 连接 | SQLAlchemy `create_engine` | **复用** v2 `workspace.py` |
| 文件导入 | pandas `read_csv/read_excel` → SQLite | **新开发** |
| URL 验证 | SQLAlchemy `engine.connect()` 测试 | **复用** |

**开源依赖**: SQLAlchemy, pandas (文件导入)

---

### Stage 2: introspect — Schema 自动发现

**功能**:
- 自动发现所有表、列名、数据类型
- 列级统计: cardinality、NULL率、min/max、样本值（top-5 distinct）
- 推断外键关系（同名列 + 类型匹配 + 值重叠检测）
- 识别列角色: 度量字段（可SUM/AVG的数值列）vs 维度字段（低cardinality的分类列）

**输出**:
```json
{
  "tables": {
    "sales_delivery": {
      "row_count": 4925,
      "columns": {
        "deliv_qty_mt": {
          "type": "REAL", "nullable": true,
          "stats": {"min": 0.1, "max": 120.5, "avg": 15.3, "null_pct": 0},
          "role": "measure"
        },
        "brnch_code": {
          "type": "TEXT", "nullable": false,
          "stats": {"cardinality": 5, "top_values": ["CQSO","CDSO","YBSO","LZSO","MYSO"]},
          "role": "dimension"
        }
      }
    }
  },
  "inferred_fks": [
    {"from": "sales_delivery.brnch_code", "to": "rolling_plan.brnch_code", "confidence": 0.95}
  ]
}
```

**技术方案**:
| 组件 | 方案 | 来源 |
|------|------|------|
| Schema 发现 | SQLAlchemy `inspect(engine)` | **新开发** |
| 列统计 | SQL聚合查询 (COUNT DISTINCT, MIN, MAX, AVG) | **新开发** |
| FK 推断 | 列名匹配 + 值重叠率计算 | **新开发** |
| 列角色识别 | 规则: numeric + high cardinality → measure; low cardinality → dimension | **新开发** |

**开源依赖**: SQLAlchemy (inspect)

---

### Stage 3: enrich — 语义标注

**功能**:
- LLM 为每张表生成: 中文别名、业务描述、行粒度说明
- LLM 为每个字段生成: 中文别名、业务含义、值域说明、注意事项
- LLM 推断业务规则: 过滤条件（如"退货需排除"）、计算公式（如"达成率=实际/计划"）、JOIN 关系
- LLM 生成查询词映射: 中文术语 → SQL表达式
- 输出 `schema_dict.yaml`，状态为 `needs_review`（前端展示可编辑表格）

**输出**: `schema_dict.yaml`（结构同现有格式，含 tables / business_rules / query_term_mapping / table_relationships）

**技术方案**:
| 组件 | 方案 | 来源 |
|------|------|------|
| LLM 标注 | 分批调用 LLM (每张表一次，避免 token 溢出) | **新开发** |
| 提示词模板 | 注入 introspect 结果 + 样本数据 → LLM 生成语义 | **新开发** |
| 输出格式 | 直接输出 YAML（schema_builder 可消费的格式） | **复用** v2 schema_dict 格式 |
| 人工审核 | 前端 SchemaReview 页面（可编辑表格） | **新开发前端** |

**提示词策略**:
```
你是数据治理专家。以下是数据库表 {table_name} 的结构和样本数据：

列信息：
{columns_with_stats}

样本数据（前5行）：
{sample_rows}

请生成：
1. 表的中文别名和业务描述
2. 每个字段的中文名、业务含义、注意事项
3. 重要的业务规则（过滤条件、计算公式）
4. 与其他表的关联关系

返回 YAML 格式。
```

**开源依赖**: LangChain/OpenAI SDK（LLM调用）

---

### Stage 4: build_kg — 知识图谱构建

**功能**:
- 从 enriched schema 提取**实体**: 表 → TableEntity, 列 → ColumnEntity, 度量 → MetricEntity, 维度 → DimensionEntity
- 提取**关系**: FK/JOIN → structural edges, 业务规则 → semantic edges
- LLM 推断**因果边**: "指标A异常时，可能原因是什么？"（基于领域知识）
- 生成**业务场景**: 每个场景包含入口指标、下钻维度、关联指标链
- 输出 `knowledge_graph.json`（nodes + edges + scenarios），状态为 `needs_review`

**输出**:
```json
{
  "nodes": [
    {"id": "metric_achievement_rate", "type": "metric", "label": "整体达成率", 
     "table": "sales_delivery JOIN rolling_plan", "description": "...",
     "threshold": {"warn": 90, "alert": 80}, "threshold_op": "<"},
    {"id": "dim_branch", "type": "dimension", "label": "分公司", 
     "column": "brnch_descrptn", "table": "sales_delivery"}
  ],
  "edges": [
    {"from": "metric_achievement_rate", "to": "metric_order_backlog", 
     "type": "causal", "label": "达成不足可能由订单倒挂导致"},
    {"from": "metric_achievement_rate", "to": "dim_branch", 
     "type": "drilldown", "label": "可按分公司下钻"}
  ],
  "scenarios": [
    {"id": "sales_achievement", "title": "销量达成归因", 
     "entry_node": "metric_achievement_rate",
     "keywords": ["达成", "完成率", "进度"],
     "description": "分析销量达成率异常的根因"}
  ]
}
```

**技术方案**:
| 组件 | 方案 | 来源 |
|------|------|------|
| 实体提取 | 规则 + schema 结构 (measures→metric, dimensions→dim) | **复用** v1 `build_knowledge_graph_v3.py` 的模式匹配 |
| 关系提取 | FK → structural edges; 业务规则 → semantic edges | **部分复用** v1 关系定义 |
| 因果推断 | LLM 基于行业知识生成因果假设 | **新开发** |
| 场景生成 | LLM 从指标+因果边自动组织业务场景 | **新开发** |
| 人工审核 | 前端 KnowledgeGraph 页面（图可视化 + 编辑） | **复用** v1 `CausalGraph.tsx` 页面逻辑 |

**LLM 因果推断提示词**:
```
你是供应链/业务分析领域专家。以下是一个数据库的指标体系：

指标列表：
{metrics_with_descriptions}

请推断这些指标之间的因果关系。对于每个指标，回答：
- 当该指标异常时，最可能的上游原因指标是什么？
- 该指标异常可能导致哪些下游指标受影响？
- 该指标适合按哪些维度下钻？

返回 JSON edges 列表。
```

**开源依赖**: NetworkX（图存储/遍历/验证DAG无环）

---

### Stage 5: train_sql — SQL RAG 训练

**功能**:
- 从 KG 自动生成 Q&A 训练对:
  - 每个 metric 节点 → "本月{metric_label}是多少？" → 对应 SQL
  - 每个 drilldown edge → "按{dimension}看{metric}" → GROUP BY SQL
  - 每个 causal edge → "{metric_A}异常，是因为{metric_B}吗？" → 验证 SQL
- 合并用户手工编写的 `few_shots.json`
- 存入 ChromaDB（question 做 embedding，SQL 做 metadata）
- 同时存入 DDL 文档和业务规则文档

**输出**: 训练好的 ChromaDB 索引 + 训练报告（examples数量、覆盖的场景）

**技术方案**:
| 组件 | 方案 | 来源 |
|------|------|------|
| Q&A 自动生成 | 从 KG 模板化生成 | **新开发** |
| 向量存储 | ChromaDB (PersistentClient) | **复用** v2 `SqlRagStore` |
| DDL/规则存入 | `schema_builder.build_ddl()` + `build_rules_context()` | **复用** v2 |
| 手工示例 | 读取 `few_shots.json` | **复用** v2 |

**开源依赖**: ChromaDB

---

### Stage 6: text_to_sql — KG 引导的 SQL 生成（运行时）

**功能**:
1. 意图识别: 用户问题 → scenario + filters + 是否归因
2. KG 子图检索: 从 KG 中找到与问题最相关的 metric/dimension 节点
3. 上下文聚焦: 只注入相关表/字段的 schema（而非全部），减少 token 浪费
4. SQL 生成: LLM 基于聚焦 schema + 匹配 few-shots + 业务规则生成 SQL
5. SQL 执行: 执行并返回结果
6. 结果解读: LLM 用业务语言解读数据

**与当前 v2 的差异**:
| | 当前 v2 | 新设计 |
|---|---|---|
| 上下文选择 | 全量 schema_dict 注入 | KG 子图检索 → 只注入相关部分 |
| Few-shot | 随机 top-N | KG 场景匹配 + 向量相似度 |
| 意图识别 | 独立 LLM 调用 | KG 节点匹配 + LLM 确认 |
| SQL 验证 | 无 | 执行后校验（行数、类型、NULL） |

**技术方案**:
| 组件 | 方案 | 来源 |
|------|------|------|
| 意图识别 | **复用** v1 `intent.py` 逻辑，数据从 KG 读取 | 复用+改造 |
| KG 子图检索 | 向量检索 (ChromaDB) + 图遍历 (1-hop neighbors) | **复用** v1 `embed_retriever` 逻辑 |
| Schema 聚焦 | 从 KG matched nodes 收集 table.column → 裁剪 schema_context | **新开发** |
| SQL 生成 | **复用** v1 `sql_gen.py` 的 prompt 分层构建 | 复用+改造 |
| SQL 执行 | **复用** v2 `execute_node.py` | 复用 |
| 结果解读 | **复用** v1 `executor.build_interpret_prompt` + LLM 流式 | 复用 |

**开源依赖**: LangChain (LLM), ChromaDB (检索)

---

### Stage 7: attribution — 多路归因分析（运行时）

**功能**:
1. 起点定位: 从 KG 找到异常指标对应的节点
2. 路径枚举: 沿 KG causal edges **向上游遍历**，枚举所有可能归因路径（BFS/DFS，最大深度5）
3. 并行假设验证: 对每条路径上的每个节点，生成 SQL → 执行 → 获取指标值 → 与阈值对比
4. 证据评分: 异常程度（偏离阈值比例）→ 路径总分 = 各节点异常分之积
5. 排序输出: Top-K 条归因路径，每条路径附带完整证据链
6. 结论生成: LLM 综合 Top-K 路径生成归因报告

**与当前 v2 的差异**:
| | 当前 v2 | 新设计 |
|---|---|---|
| 归因路径 | 线性单链（children[0]） | KG 多路 BFS，枚举所有路径 |
| 节点 SQL | 硬编码 metric_sql / LLM逐个生成 | KG 节点定义 + LLM 生成（Stage 6 复用） |
| 停止条件 | 正常即停 | 继续探索其他路径 |
| 输出 | 单条结论 | Top-K 排序的归因路径 + 综合报告 |

**技术方案**:
| 组件 | 方案 | 来源 |
|------|------|------|
| 图遍历 | Neo4j Cypher (MATCH path = shortestPath / allShortestPaths) | **新开发** (参考 v1 `reasoning.py` 的 `get_upstream_nodes`) |
| 节点执行 | 复用 Stage 6 的 SQL 生成+执行逻辑 | 复用 |
| 异常判断 | 阈值对比 + 统计检验 (z-score) | **新开发** (v1 只有LLM判断) |
| 证据评分 | 偏离度加权（`|value - threshold| / threshold`） | **新开发** |
| 结论生成 | **复用** v1 `synthesize_conclusion` 逻辑 | 复用+改造 |
| 反思循环 | 可选 LangGraph（节点执行→反思→继续/终止） | **复用** v2 LangGraph 模式 |

**开源依赖**: NetworkX (图遍历), LangGraph (可选，反思循环)

---

## 5. 数据流与持久化

### 5.1 Workspace 目录结构

```
workspaces/<name>/
├── workspace.yaml              # 基本配置（Stage 1 写入）
├── pipeline_state.json         # Pipeline 进度状态
├── stages/                     # 每个 Stage 的输出
│   ├── connect.json            # Stage 1 输出
│   ├── introspect.json         # Stage 2 输出
│   ├── enrich.json             # Stage 3 原始输出（LLM生成）
│   ├── build_kg.json           # Stage 4 原始输出
│   └── train_sql.json          # Stage 5 训练报告
├── schema_dict.yaml            # Stage 3 产出（可人工编辑后覆盖）
├── knowledge_graph.json        # Stage 4 产出（可人工编辑后覆盖）
├── few_shots.json              # Stage 5 自动 + 手工示例
├── scenarios/                  # 从 KG scenarios 展开的场景配置
└── .chroma/                    # ChromaDB 持久化索引
```

### 5.2 Pipeline State

```json
{
  "workspace": "supply-chain",
  "pipeline_type": "setup",
  "status": "paused",
  "stages": [
    {"name": "connect",    "status": "completed", "completed_at": "..."},
    {"name": "introspect", "status": "completed", "completed_at": "..."},
    {"name": "enrich",     "status": "needs_review", "completed_at": "..."},
    {"name": "build_kg",   "status": "pending"},
    {"name": "train_sql",  "status": "pending"}
  ]
}
```

---

## 6. Backend API 设计

### 6.1 Pipeline 管理

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/workspaces` | 创建 workspace（name, db_url） |
| `POST` | `/api/workspaces/{ws}/pipeline/create` | 初始化 setup pipeline |
| `GET` | `/api/workspaces/{ws}/pipeline` | 获取 pipeline 状态 |
| `POST` | `/api/workspaces/{ws}/pipeline/run/{stage}` | 执行指定 stage |
| `POST` | `/api/workspaces/{ws}/pipeline/next` | 执行下一个 pending stage |
| `GET` | `/api/workspaces/{ws}/pipeline/result/{stage}` | 获取 stage 输出 |
| `PUT` | `/api/workspaces/{ws}/pipeline/review/{stage}` | 提交人工审核结果 |
| `POST` | `/api/workspaces/{ws}/pipeline/skip/{stage}` | 跳过 stage |

### 6.2 Runtime 查询

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/workspaces/{ws}/query` | SSE 流式查询（自动路由 text2sql / attribution） |

### 6.3 保留的现有 API

| Method | Path | 说明 | 来源 |
|--------|------|------|------|
| `GET` | `/api/workspaces` | 列出所有 workspace | 复用 v2 |
| `GET` | `/api/workspaces/{ws}` | workspace 元数据 | 复用 v2 |
| `GET` | `/api/workspaces/{ws}/schema` | schema_dict | 复用 v2 |
| `GET` | `/api/workspaces/{ws}/graph` | KG 图谱数据 | 复用 v2 |
| `GET` | `/api/explorer/{ws}/tables` | 表列表 | 复用 v2 |
| `POST` | `/api/explorer/{ws}/query` | 自定义 SQL | 复用 v2 |

---

## 7. 前端页面设计

### 7.1 页面清单

| 页面 | 路由 | 功能 | 来源 |
|------|------|------|------|
| Home | `/` | Workspace 列表 + 创建入口 | 改造 v2 |
| WorkspaceCreate | `/create` | 创建向导（名称 + DB URL / 上传） | 新开发 |
| PipelineSetup | `/w/:ws/setup` | 5步 Pipeline 进度 + 执行/审核 | 新开发 |
| SchemaReview | `/w/:ws/setup/schema` | 可编辑的语义标注表格 | 新开发 |
| KnowledgeGraph | `/w/:ws/setup/kg` | KG 可视化 + 编辑（DAG图） | 复用 v1 CausalGraph |
| Chat | `/w/:ws` | 智能问数（SSE 流式） | 改造 v2 |
| DataExplorer | `/w/:ws/explore` | 数据浏览 + 自定义 SQL | 复用 v2 |

### 7.2 PipelineSetup 页面交互

使用 AntDesign `Steps` 组件，每个 Step 状态:
- **Pending**: 灰色，显示"运行"按钮
- **Running**: 加载动画
- **Completed**: 绿色勾，可展开查看结果摘要
- **Needs Review**: 橙色，显示"去审核"按钮 → 跳转 SchemaReview / KnowledgeGraph
- **Failed**: 红色，显示错误信息 + "重试"按钮
- **Skipped**: 灰色，显示"已跳过"

### 7.3 SchemaReview 页面交互

- 左侧: 表列表（可切换）
- 右侧: 可编辑的字段表格
  - 列: 字段名(只读) | 类型(只读) | 中文别名(可编辑) | 描述(可编辑) | 角色(下拉) | 注意事项(可编辑)
- 底部: 业务规则编辑区（YAML/JSON 编辑器）
- 操作: "保存并继续" → PUT review → POST next

### 7.4 Chat 页面改进

与当前 v2 基本一致，增加:
- 归因结果展示: 多条路径卡片，每条显示证据链
- KG 子图高亮: 显示本次查询命中的 KG 节点
- SQL 来源标注: "由KG引导生成" / "由RAG检索" / "由LLM直接生成"

---

## 8. 技术选型与开源组件

### 8.1 核心框架

| 组件 | 选型 | 用途 |
|------|------|------|
| Web 框架 | **FastAPI** | REST + SSE + 异步 |
| 状态机 | **LangGraph** | Runtime 归因反思循环（Stage 7 内部） |
| LLM 调用 | **LangChain ChatOpenAI** | 兼容 OpenAI/Gemini/Kimi/DeepSeek |
| 向量检索 | **ChromaDB** | SQL RAG + KG 节点检索 |
| 数据库抽象 | **SQLAlchemy** | 多数据库支持 |
| 图数据库 | **Neo4j** | KG 存储、Cypher 查询、图遍历、路径枚举 |
| 前端 | **React + Vite + AntDesign** | SPA |
| 图可视化 | **AntV G6** 或 **ReactFlow** | KG DAG 展示 |

### 8.2 各 Stage 的开源依赖

| Stage | 依赖 | 说明 |
|-------|------|------|
| connect | SQLAlchemy, pandas | 连接测试 + 文件导入 |
| introspect | SQLAlchemy `inspect` | Schema 反射 |
| enrich | LangChain | LLM 语义标注 |
| build_kg | Neo4j, LangChain | 图构建 + LLM 因果推断 |
| train_sql | ChromaDB | 向量索引 |
| text_to_sql | ChromaDB, LangChain | 检索 + LLM SQL 生成 |
| attribution | Neo4j, LangGraph | 多路遍历 (Cypher) + 反思循环 |

---

## 9. 复用清单

### 9.1 从 v2 复用（直接使用或小改）

| 文件 | 复用方式 |
|------|----------|
| `knowledge/workspace.py` | 扩展: 增加 pipeline state 读写方法 |
| `knowledge/schema_builder.py` | 原样复用 |
| `knowledge/vanna_store.py` | 原样复用 (Stage 5 内部) |
| `knowledge/doc_retriever.py` | 原样复用 |
| `backend/main.py` | 扩展: 增加 pipeline router |
| `backend/config.py` | 原样复用 |
| `backend/routers/workspace.py` | 扩展: 增加创建 workspace 接口 |
| `backend/routers/explorer.py` | 原样复用 |
| `frontend/src/pages/Home.tsx` | 扩展: 增加创建按钮 |
| `frontend/src/pages/Chat.tsx` | 改造: 接入新 runtime API |
| `frontend/src/api/client.ts` | 扩展: 增加 pipeline API |
| `workspaces/template/` | 原样复用 |

### 9.2 从 v1 (Arawana) 复用（需移植改造）

| v1 文件 | 复用到 | 改造内容 |
|---------|--------|----------|
| `engine/reasoning_v2.py` 的双分支路由 | Stage 6+7 路由逻辑 | 去掉硬编码关键词，改为 KG 驱动 |
| `engine/reasoning.py` 的 `get_upstream_nodes()` | Stage 7 图遍历 | 改为 NetworkX API |
| `engine/reasoning.py` 的 `synthesize_conclusion()` | Stage 7 结论生成 | 提示词参数化 |
| `engine/sql_gen.py` 的 prompt 分层构建 | Stage 6 SQL 生成 | schema 来源从文件改为 KG 子图 |
| `engine/intent.py` 的意图解析 | Stage 6 意图识别 | 场景列表从 KG scenarios 读取 |
| `engine/executor.py` 的图表建议 | Stage 6 结果解读 | 原样可用 |
| `engine/embed_retriever.py` 的检索逻辑 | Stage 6 KG 子图检索 | 改为 ChromaDB 统一检索 |
| `scripts/build_knowledge_graph_v3.py` 的实体模式 | Stage 4 实体提取 | 泛化为配置驱动 |
| `knowledge/causal_graph.json` 的结构 | Stage 4 KG 输出格式 | nodes/edges/scenarios 格式保留 |
| `frontend/CausalGraph.tsx` | KnowledgeGraph 页面 | 增加编辑功能 |

### 9.3 全新开发

| 模块 | 说明 |
|------|------|
| `core/stage.py` | Stage 基类 + Registry |
| `core/pipeline.py` | Pipeline Orchestrator |
| `core/persistence.py` | Stage 结果持久化 |
| `core/stages/connect.py` | 数据源连接 |
| `core/stages/introspect.py` | Schema 自动发现 |
| `core/stages/enrich.py` | LLM 语义标注 |
| `core/stages/build_kg.py` | KG 构建 |
| `core/stages/train_sql.py` | SQL RAG 训练 |
| `core/stages/text_to_sql.py` | KG 引导 SQL 生成 |
| `core/stages/attribution.py` | 多路归因 |
| `backend/routers/pipeline.py` | Pipeline API |
| `frontend/PipelineSetup.tsx` | Pipeline 管理页 |
| `frontend/SchemaReview.tsx` | Schema 审核页 |
| `frontend/KnowledgeGraph.tsx` | KG 可视化编辑页 |
| `frontend/WorkspaceCreate.tsx` | 创建向导 |

---

## 10. 实施计划

### Phase 1: 框架层（Stage 基座 + Pipeline + API）
- `core/stage.py`, `core/pipeline.py`, `core/persistence.py`
- `backend/routers/pipeline.py`
- 所有 Stage 的空壳实现（接口就位，返回 mock 数据）
- 预计: 可独立测试 Pipeline 流转

### Phase 2: Setup Stage 1-3（连接 → 发现 → 标注）
- `core/stages/connect.py`, `introspect.py`, `enrich.py`
- 前端: `WorkspaceCreate.tsx`, `PipelineSetup.tsx`, `SchemaReview.tsx`
- 预计: 可从零创建 workspace 并完成 schema 标注

### Phase 3: Setup Stage 4-5（KG 构建 → RAG 训练）
- `core/stages/build_kg.py`, `train_sql.py`
- 前端: `KnowledgeGraph.tsx`
- 预计: 可完整跑通 Setup Pipeline

### Phase 4: Runtime Stage 6-7（SQL 生成 + 归因）
- `core/stages/text_to_sql.py`, `attribution.py`
- 改造 `backend/routers/chat.py`
- 前端: Chat 页面改造
- 预计: 可端到端提问 + 归因

### Phase 5: 打磨
- 错误处理、重试、跳过
- 性能优化（缓存 KG 子图检索）
- 导入现有 supply-chain workspace 数据（迁移兼容）
- 端到端测试

---

## 11. 现有 POC 数据

当前可用于测试的数据源:

| 表 | 行数 | 列数 | 说明 |
|----|------|------|------|
| sales_delivery | 4,925 | 41 | 提单明细 |
| sales_order | 5,725 | 42 | 销售订单 |
| rolling_plan | 793 | 27 | 滚动计划 |
| inventory | 1,620 | 13 | 库存快照 |
| production_output | 2,584 | 16 | 生产产出 |
| quality_inspection | 2,584 | 14 | 质量检验 |
| overtime_hours | 5,504 | 14 | 加班工时 |
| procurement | 394 | 17 | 采购记录 |
| customer_complaint | 300 | 15 | 客户投诉 |
| promotion | 91 | 15 | 促销活动 |
| **合计** | **24,520** | — | 10张表 |

---

## 12. 确认的技术决策

1. **KG 存储**: **Neo4j** — 原生图数据库，支持 Cypher 查询、图遍历、可视化
2. **Embedding**: **外部 API**（Gemini / OpenAI embedding），ChromaDB 存储向量但不用内置 embedding
3. **文件上传**: 支持 DB URL + CSV/Excel 上传（上传后自动建 SQLite）
4. **多用户**: 先 token 认证，不做用户体系
5. **部署**: 加 Dockerfile + docker-compose（Neo4j + app）
