# DataAgent v2 — 系统现状文档

> 版本: 2.0 | 文档日期: 2026-04-03 | 状态: 核心功能已完成，进入下一阶段迭代

---

## 1. 系统概述

DataAgent v2 是一个**可插拔的数据智能体平台**，面向拥有业务数据库但缺乏专业数据分析能力的企业团队。系统的核心能力是：指定数据源后，自动完成从 Schema 理解、语义治理、知识图谱构建，到自然语言转 SQL 查询、多路因果归因分析的完整链路。

**目标用户**: 业务分析师、数据运营团队、需要快速进行数据归因分析但不具备深度 SQL 技能的业务人员。

**核心理念**:
- **模块热插拔**: 每个环节是独立 Stage，可单独替换、跳过或重跑
- **人机协同**: 语义标注、KG 审核等关键环节支持暂停 → 人工编辑 → 继续执行
- **配置驱动**: 接入新业务场景只需配置，不改代码
- **渐进式构建**: 每个 Stage 的产出可独立使用，无需跑完全链路

**在线访问**: https://data-agent.ai-node.org/

---

## 2. 技术架构

### 2.1 总体架构

```
┌─────────────────── 前端交互层 (React 19 + AntDesign) ───────────────────┐
│  Home  WorkspaceCreate  PipelineSetup  SchemaReview  AttributionExplorer │
│  CausalGraph  DataBrowser  DataGovernance  QueryLogs  SystemConfig        │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │ REST + SSE (Server-Sent Events)
┌──────────────────────▼──────────────────────────────────────────────────┐
│              Backend API (FastAPI 0.111 + Python 3.11)                   │
│  /api/chat   /api/workspaces/*   /api/pipeline/*   /api/explorer/*       │
│  /api/graph/*   /api/scenarios/*   /api/logs/*   /api/system/*           │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────────────┐
│              Pipeline Orchestrator (PipelineOrchestrator)                 │
│                                                                           │
│  Setup Pipeline (每个 workspace 执行一次):                                │
│  [connect] → [introspect] → [enrich] → [build_kg] → [train_sql]         │
│                                                                           │
│  Runtime Pipeline (每次用户提问执行):                                     │
│  [text_to_sql]  /  [attribution]                                         │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────────────┐
│                      Knowledge Layer                                      │
│   Workspace (YAML+JSON 持久化)  ·  Neo4j (知识图谱)  ·  ChromaDB (RAG)  │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │
              ┌────────▼─────────┐
              │   Data Sources    │
              │  SQLite / PG / MySQL  │
              └───────────────────┘
```

### 2.2 技术栈明细

| 层次 | 技术组件 | 版本 / 说明 |
|------|----------|------------|
| **前端框架** | React + TypeScript | React 19, Vite 构建 |
| **前端 UI** | Ant Design | 组件库，响应式侧边栏 |
| **前端图表** | ECharts | 知识图谱 DAG 可视化 |
| **后端框架** | FastAPI | Python 3.11, uvicorn |
| **ORM / DB** | SQLAlchemy | 多数据库适配 (SQLite/PG/MySQL) |
| **向量数据库** | ChromaDB | SQL RAG 检索，持久化到 workspaces/.chroma |
| **图数据库** | Neo4j 5.26 | 知识图谱存储，含 APOC 插件 |
| **LLM 集成** | LangChain | Text-to-SQL, Schema 语义增强 |
| **反向代理** | Caddy | HTTPS 终止，路由到 8001 端口 |
| **容器化** | Docker + docker-compose | 多阶段构建 |
| **部署环境** | AWS EC2 | 公网访问 data-agent.ai-node.org |

---

## 3. 已完成模块

### 3.1 核心框架

#### StageBase / StageRegistry — 可插拔 Stage 体系

每个 Stage 继承 `StageBase` 抽象类，通过 `@StageRegistry.register` 装饰器自动注册。关键接口：

| 方法 | 说明 |
|------|------|
| `run(workspace, input_data, config) → StageResult` | 执行阶段，必须幂等（可安全重跑） |
| `validate_input(workspace, input_data) → list[str]` | 输入校验，返回错误列表 |
| `get_default_config() → dict` | 返回默认配置 |
| `meta() → dict` | 序列化元数据，供 API 响应使用 |

`StageResult` 携带三种状态：`success` / `failed` / `needs_review`（触发前端暂停并展示编辑界面）。

#### PipelineOrchestrator — 流水线编排器

无状态编排器，所有状态以 JSON 文件持久化到各 workspace 目录下。核心能力：

- `create_pipeline()` — 初始化（或重置）setup pipeline，幂等
- `run_stage()` — 执行指定 Stage，含前置校验、异常捕获、结果持久化
- `run_next()` — 自动读取前一 Stage 输出，执行下一个 pending Stage
- `submit_review()` — 接收人工编辑数据，覆盖 Stage 结果，推进流水线
- `skip_stage()` — 跳过某个 Stage

---

### 3.2 Pipeline 阶段（共 7 个）

#### Setup Pipeline（每个 workspace 初始化时执行一次）

| # | Stage | 显示名 | 功能 | 输入 | 输出 | 审核要求 |
|---|-------|--------|------|------|------|---------|
| 1 | `connect` | 数据源连接 | 验证 DB 连接，支持 SQLite / PG / MySQL，以及 CSV/Excel 文件导入（自动建 SQLite） | DB URL 或文件路径 | `{db_url, db_type, table_count, total_rows, connected: true}` | 自动 |
| 2 | `introspect` | Schema 自动发现 | 扫描所有表/列，计算列级统计（cardinality、NULL率、min/max、top-5 distinct值），推断外键关系，识别 measure / dimension 角色 | 数据库连接 | 原始 schema JSON（列统计 + 角色标注） | 自动 |
| 3 | `enrich` | 语义标注 | 调用 LLM 为每个表/列生成中文业务名称、描述、业务规则，生成 `schema_dict.yaml` | 原始 schema | 语义增强的 `schema_dict.yaml` | **需人工审核** |
| 4 | `build_kg` | 知识图谱构建 | 将语义 schema 转换为 Neo4j 图（Metric / Dimension / Table 节点 + CAUSES / RELATES_TO 边），写入归因场景 (Scenario) | schema_dict + 业务规则 | Neo4j 图谱（节点 + 边 + 场景） | **需人工审核** |
| 5 | `train_sql` | SQL 样本训练 | 生成覆盖各场景的 SQL 范例，向量化后写入 ChromaDB，用于后续 RAG 检索 | KG + schema + few_shots | ChromaDB 向量索引 | 自动 |

#### Runtime Pipeline（每次用户提问触发）

| # | Stage | 显示名 | 功能 | 输入 | 输出 |
|---|-------|--------|------|------|------|
| 6 | `text_to_sql` | 自然语言转 SQL | 从 ChromaDB 检索相关 SQL 样本，结合 KG 子图聚焦 schema 上下文，调用 LLM 生成并执行 SQL，输出解读文字 | 用户问题 | `{sql, result: {columns, rows}, interpretation}` |
| 7 | `attribution` | 因果归因分析 | 识别异常指标，沿 KG 因果边逐级溯源，对每个节点执行 SQL 获取实际值与阈值对比，生成多路归因路径及总结 | 异常指标 + KG | `{paths: [{steps, deviation}], conclusion}` |

**运行时路由策略**: 问题含"为什么、原因、归因、怎么"等关键词 → 触发 `attribution`；普通查询 → 触发 `text_to_sql`。

---

### 3.3 后端 API

所有 API 前缀为 `/api`，通过 FastAPI 路由注册。

#### Chat（`routers/chat.py`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | LangGraph 驱动的流式 SSE 聊天（旧接口，兼容保留） |

#### Workspace（`routers/workspace.py`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workspaces` | 列出所有 workspace |
| GET | `/api/workspaces/{name}` | 获取 workspace 元数据（标题、描述、场景、当前时期） |
| GET | `/api/workspaces/{name}/schema` | 获取 `schema_dict.yaml` 内容（JSON 格式） |
| GET | `/api/workspaces/{name}/graph` | 获取因果图节点 + 边（来自 causal_graph.json） |
| GET | `/api/workspaces/{name}/examples` | 获取 few_shots 样本 |

#### Pipeline（`routers/pipeline.py`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/workspaces` | 创建新 workspace（含 DB 连接） |
| POST | `/api/workspaces/{ws}/pipeline/create` | 初始化（或重置）setup pipeline |
| GET | `/api/workspaces/{ws}/pipeline` | 获取 pipeline 当前状态 |
| POST | `/api/workspaces/{ws}/pipeline/run/{stage}` | 执行指定 Stage |
| POST | `/api/workspaces/{ws}/pipeline/next` | 执行下一个 pending Stage |
| GET | `/api/workspaces/{ws}/pipeline/result/{stage}` | 获取 Stage 执行结果 |
| PUT | `/api/workspaces/{ws}/pipeline/review/{stage}` | 提交人工编辑后的 Stage 输出 |
| POST | `/api/workspaces/{ws}/pipeline/skip/{stage}` | 跳过某个 Stage |
| GET | `/api/pipeline/stages` | 列出所有已注册 Stage 的元数据 |
| GET | `/api/workspaces/{ws}/kg` | 从 Neo4j 获取 workspace KG 节点 + 边 |
| POST | `/api/workspaces/{ws}/chat` | Pipeline 驱动的新版 SSE 聊天接口（主接口） |

#### Explorer（`routers/explorer.py`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/explorer/{workspace}/tables` | 列出所有表及行数、列数 |
| GET | `/api/explorer/{workspace}/tables/{table}/schema` | 获取表字段列表（含类型、主键、可空） |
| GET | `/api/explorer/{workspace}/tables/{table}/data` | 预览表数据（默认 50 行，最多 500 行） |
| POST | `/api/explorer/{workspace}/query` | 执行只读 SELECT 查询 |

#### Graph（`routers/graph.py`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/graph/{ws}` | 返回 ECharts DAG 格式的完整 KG（优先 Neo4j，回退 causal_graph.json），含节点分类统计 |

#### Scenarios（`routers/scenarios.py`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/scenarios/{ws}` | 列出 workspace 所有场景（优先 Neo4j，回退 JSON 文件） |
| GET | `/api/scenarios/{ws}/{scenario_id}` | 获取单个场景详情 |
| GET | `/api/scenarios/{ws}/{scenario_id}/kpis` | 执行聚合 SQL，返回各 KPI 当前值 |

#### Logs（`routers/logs.py`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs/{ws}` | 分页获取查询日志（支持按评分过滤） |
| GET | `/api/logs/{ws}/stats` | 获取查询统计（总数、成功率、平均耗时等） |
| GET | `/api/logs/{ws}/{log_id}` | 获取单条查询日志 |
| POST | `/api/logs/{ws}/{log_id}/feedback` | 提交 1-5 星评分及反馈文字 |

#### System（`routers/system.py`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/system/health` | 检查数据库、Neo4j、知识目录健康状态 |
| GET | `/api/system/config` | 获取当前 LLM 配置（API key 脱敏显示） |
| PUT | `/api/system/config` | 更新 LLM 配置（写入 .env 文件） |
| POST | `/api/system/test-connection` | 测试 LLM API 连通性 |
| GET | `/api/system/sample-questions/{ws}` | 按场景分组返回示例问题 |
| GET | `/api/system/few-shots/{ws}` | 返回 workspace 原始 few_shots 内容 |

#### 系统内置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 基础健康检查（版本 + 默认 workspace） |

---

### 3.4 前端页面

前端使用 React Router，分两类路由：无侧边栏（顶层页面）和带 AppLayout 侧边栏（workspace 内页面）。

AppLayout 侧边栏分两个导航分区：
- **分析区**: 归因探索 / 知识体系 / 数据探索
- **管理区**: 知识构建 / 数据治理 / 查询日志 / 系统配置

#### 顶层页面（无侧边栏）

| 页面 | 路由 | 文件 | 功能 |
|------|------|------|------|
| Home | `/` | `pages/Home.tsx` | 平台首页，Workspace 列表入口，新建 Workspace 引导 |
| WorkspaceCreate | `/create` | `pages/WorkspaceCreate.tsx` | 创建新 Workspace（填写名称、DB URL、标题描述） |

#### Workspace 分析页面（带侧边栏）

| 页面 | 路由 | 文件 | 功能 | 完成度 |
|------|------|------|------|--------|
| AttributionExplorer | `/w/:workspace` | `pages/AttributionExplorer.tsx` | 主聊天界面，SSE 流式对话，展示 SQL、数据表格、归因步骤、解读文字 | 完整实现 |
| CausalGraph | `/w/:workspace/graph` | `pages/CausalGraph.tsx` | ECharts DAG 知识图谱可视化，按场景筛选，节点类型标色 | 占位实现 |
| DataBrowser | `/w/:workspace/data` | `pages/DataBrowser.tsx` | 数据探索，表格预览，字段 schema 查看，自定义 SQL 执行 | 占位实现 |

#### Workspace 管理页面（带侧边栏）

| 页面 | 路由 | 文件 | 功能 | 完成度 |
|------|------|------|------|--------|
| PipelineSetup | `/w/:workspace/setup` | `pages/PipelineSetup.tsx` | Pipeline 构建器，阶段状态展示，逐 Stage 触发执行 | 完整实现 |
| SchemaReview | `/w/:workspace/setup/schema` | `pages/SchemaReview.tsx` | Enrich Stage 的人工审核界面，表格式编辑语义标注 | 完整实现 |
| DataGovernance | `/w/:workspace/governance` | `pages/DataGovernance.tsx` | 数据治理管理界面（Schema 总览、业务规则管理） | 完整实现 |
| QueryLogs | `/w/:workspace/logs` | `pages/QueryLogs.tsx` | 查询历史记录，支持评分、反馈，统计图表 | 占位实现 |
| SystemConfig | `/w/:workspace/config` | `pages/SystemConfig.tsx` | 系统配置，LLM 参数设置，连通性测试，健康检查 | 占位实现 |

#### 前端共享组件（`src/components/`）

| 组件 | 文件 | 用途 |
|------|------|------|
| ChartRenderer | `ChartRenderer.tsx` | ECharts 图表渲染（支持 bar/line/pie 等） |
| ChatMessage | `ChatMessage.tsx` | 聊天消息气泡，含 SQL 展示、数据表格 |
| DataTable | `DataTable.tsx` | 通用数据表格（AntDesign Table 封装） |
| KpiCard | `KpiCard.tsx` | KPI 指标卡片组件 |
| SqlViewer | `SqlViewer.tsx` | SQL 代码高亮展示 |
| StreamingText | `StreamingText.tsx` | SSE 流式文字渐进显示动效 |

---

### 3.5 基础设施

#### Dockerfile — 多阶段构建

```
Stage 1 (frontend-builder): node:20-slim
  - npm ci + npm run build → 生成 /frontend/dist

Stage 2 (app): python:3.11-slim
  - 安装系统依赖 (libpq-dev, gcc, curl)
  - pip install -e . (依赖层缓存优化)
  - 复制 core/ backend/ knowledge/ 源码
  - 从 Stage 1 复制 frontend/dist/
  - 暴露端口 8001，CMD: uvicorn backend.main:app
```

#### docker-compose.yml

```
Services:
  neo4j:
    image: neo4j:5.26 (含 APOC 插件)
    堆内存上限: 512m
    端口: 7474 (Browser) / 7687 (Bolt)
    持久化: neo4j_data 命名卷
    健康检查: cypher-shell RETURN 1

  app:
    build: . (使用 Dockerfile 构建)
    端口: 8001
    依赖 neo4j 健康后启动
    env_file: .env
    NEO4J_URI 覆盖为 bolt://neo4j:7687 (Docker 内网)
    volumes: ./workspaces:/app/workspaces (含 ChromaDB 数据)
```

#### Caddy 反向代理

部署于 AWS EC2，作为 HTTPS 终止层，将 `data-agent.ai-node.org` 的 HTTPS 请求代理到本机 `localhost:8001`。前端 SPA 由 FastAPI 静态文件服务直接提供，无需额外 Nginx 层。

#### 访问控制

后端内置 token 中间件（`auth_middleware`），支持 Bearer header、URL query param、Cookie 三种传递方式。未授权的 HTML 请求返回内嵌登录页，API 请求返回 JSON 401。

---

## 4. 已验证数据

当前系统已在 **supply-chain** workspace 上完整运行验证，数据如下：

| 数据项 | 数值 |
|--------|------|
| Workspace 名称 | `supply-chain` |
| 数据库类型 | SQLite |
| 数据表数量 | 10 张业务表 |
| 总数据行数 | 24,520 行 |
| Neo4j 图谱节点数 | 167 个 |
| Neo4j 图谱边数 | 170 条 |
| 归因场景 (Scenario) | 5 个 |
| ChromaDB 索引 Q&A 对 | 65 条 |

---

## 5. 已知问题

| # | 问题描述 | 影响范围 | 根因分析 |
|---|----------|----------|----------|
| 1 | **Text-to-SQL SQL 列名错误** | `text_to_sql` Stage | LLM 获得的 schema 上下文质量不足，LLM 易生成不存在的列名或错误拼写的列名 |
| 2 | **归因入口指标匹配精度低** | `attribution` Stage | 当前使用朴素子串匹配（substring match）识别问题中的异常指标，容易误匹配或漏匹配 |
| 3 | **前端 bundle 体积偏大** | 前端加载性能 | 未做路由级别的 Code Splitting，ECharts 全量引入，首屏加载较慢 |
| 4 | **占位页面功能不完整** | CausalGraph / DataBrowser / QueryLogs / SystemConfig | 这些页面当前为占位实现，核心交互逻辑待补全 |
| 5 | **Neo4j 启动依赖** | 本地开发体验 | 开发环境需先启动 docker-compose 才能使用 KG 相关功能，无 mock 回退 |

---

## 6. 待开发（下一阶段）

### 6.1 智能体推理升级

- **Agentic 推理循环**: 引入 Plan-Execute-Reflect 三步闭环，替代当前单轮 text_to_sql；支持多步骤 SQL 分解、中间结果反思、错误自修正
- **可组合推理策略**: 将归因、趋势分析、对比分析等抽象为可组合的推理子策略，由 Planner 动态选择

### 6.2 数据接入扩展

- **多源数据适配器**: 除 SQLite/PG/MySQL 外，支持 REST API、Excel 批量文件、数仓（Hive/ClickHouse）接入
- **增量数据更新**: workspace 数据周期性刷新，KG 动态进化（新指标自动接入因果网络）

### 6.3 前端体验完善

- **交互式多步分析界面**: 支持用户在对话中对中间结果提出追问、修正分析方向
- **知识图谱交互编辑**: CausalGraph 页面支持节点/边的在线增删改，直接同步到 Neo4j
- **Code Splitting**: 按路由懒加载，压缩首屏 bundle 体积

### 6.4 知识图谱演化

- **动态 KG 演化**: 基于历史查询反馈自动发现新的因果关联，扩展图谱
- **场景模板库**: 预置供应链、销售分析、用户增长等行业场景模板，快速接入

### 6.5 工程质量

- **单元测试覆盖**: 针对各 Stage 的 `run()` 方法补充测试
- **Stage 执行超时控制**: 长时间 LLM 调用增加超时保护与重试机制
- **监控与告警**: 接入结构化日志，API 响应时间、LLM 调用成功率的可观测性

---

*文档由 Claude Code 自动生成，基于代码库实际实现状态。如有变更请同步更新本文档。*
